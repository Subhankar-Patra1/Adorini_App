import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { WebhookIdempotencyService } from './webhook-idempotency.service';
import {
  OrderStatus,
  PaymentStatus,
  WebhookProvider,
} from '../../../common/enums/domain.enums';
import { Order } from '../../../database/entities/order.entity';
import { statusAfterSuccessfulPayment } from '../../orders/services/order-state-machine';
import { OrderTransitionService } from '../../orders/services/order-transition.service';
import { WalletCreditService } from '../../wallet/services/wallet-credit.service';
import type {
  CashfreeWebhookPayload,
  DelhiveryWebhookPayload,
  Msg91WebhookPayload,
} from '../dto/webhook-payloads.dto';

/** What the endpoint reports back. Every value is answered with a 2xx — see the controller. */
export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored' | 'unmatched';

/**
 * Delhivery's coded status types, which are stable where the prose `Status`
 * field is not.
 *
 * `UD` covers everything between pickup and the doorstep, so it maps to SHIPPED;
 * once shipped, repeat `UD` scans are no-ops in the transition service.
 *
 * NOTE: this mapping is written from Delhivery's published status codes and has
 * not yet been checked against a live account — the business account is still
 * pending. Confirm the codes on the first real integration test before trusting
 * it in production; an unknown code is ignored rather than guessed.
 */
const DELHIVERY_STATUS_TYPE_MAP: Record<string, OrderStatus | undefined> = {
  PP: undefined, // Pickup pending / manifested — nothing to change yet.
  UD: OrderStatus.SHIPPED,
  DL: OrderStatus.DELIVERED,
  RT: OrderStatus.CANCELLED, // Return to origin.
  CN: OrderStatus.CANCELLED,
  LT: OrderStatus.CANCELLED, // Lost in transit.
};

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly idempotency: WebhookIdempotencyService,
    private readonly orderTransitions: OrderTransitionService,
    private readonly walletCredit: WalletCreditService,
  ) {}

  /**
   * Cashfree carries no dedicated event id, so `cf_payment_id` is the
   * de-duplication key — it is stable across redeliveries of the same payment
   * event. Falling back to `type:order_id` keeps events without a payment block
   * (user-dropped, for instance) de-duplicable rather than replayable.
   */
  async handleCashfree(payload: CashfreeWebhookPayload): Promise<WebhookOutcome> {
    const orderId = payload.data.order.order_id;
    const paymentId = payload.data.payment?.cf_payment_id;
    const eventId = paymentId ? String(paymentId) : `${payload.type}:${orderId}`;

    const ingest = await this.idempotency.ingest(
      {
        provider: WebhookProvider.CASHFREE,
        eventId,
        eventType: payload.type,
        payload,
      },
      async (manager) => this.applyCashfree(manager, payload, orderId),
    );

    return ingest.status === 'duplicate' ? 'duplicate' : ingest.result;
  }

  async handleDelhivery(payload: DelhiveryWebhookPayload): Promise<WebhookOutcome> {
    const { AWB, Status } = payload.Shipment;
    // Same absence of a provider event id; the waybill plus the scan's own
    // timestamp and status uniquely identify one tracking event.
    const eventId = `${AWB}:${Status.StatusDateTime ?? ''}:${Status.StatusType ?? Status.Status ?? ''}`;

    const ingest = await this.idempotency.ingest(
      {
        provider: WebhookProvider.DELHIVERY,
        eventId,
        eventType: Status.StatusType ?? Status.Status ?? null,
        payload,
      },
      async (manager) => this.applyDelhivery(manager, payload),
    );

    return ingest.status === 'duplicate' ? 'duplicate' : ingest.result;
  }

  async handleMsg91(payload: Msg91WebhookPayload): Promise<WebhookOutcome> {
    const eventId = payload.requestId ?? payload.message_id;

    const ingest = await this.idempotency.ingest(
      {
        provider: WebhookProvider.MSG91,
        eventId: eventId as string,
        eventType: 'DELIVERY_REPORT',
        payload,
      },
      // Recorded and nothing more: the OTP flow completes when the user enters
      // the code, so a carrier receipt has no state to advance.
      async () => Promise.resolve({ relatedEntityId: null, result: 'processed' as const }),
    );

    return ingest.status === 'duplicate' ? 'duplicate' : ingest.result;
  }

  private async applyCashfree(
    manager: EntityManager,
    payload: CashfreeWebhookPayload,
    cashfreeOrderId: string,
  ): Promise<{ relatedEntityId: string | null; result: WebhookOutcome }> {
    const order = await manager.findOne(Order, { where: { cashfreeOrderId } });

    if (!order) {
      /**
       * Recorded but not applied. A 2xx is still correct: retrying will not
       * conjure the order, and a non-2xx would have Cashfree redeliver for days.
       * The stored payload is what reconciliation works from.
       */
      this.logger.warn(`No order matches Cashfree order_id ${cashfreeOrderId}`);
      return { relatedEntityId: null, result: 'unmatched' };
    }

    switch (payload.type) {
      case 'PAYMENT_SUCCESS_WEBHOOK': {
        // COD lands in PENDING_VERIFICATION, prepaid in CONFIRMED — the state
        // machine owns that distinction, not this switch.
        const target = statusAfterSuccessfulPayment(order.paymentMethod);
        await this.orderTransitions.transition(manager, order.id, target, {
          paymentStatus: PaymentStatus.PAID,
        });
        return { relatedEntityId: order.id, result: 'processed' };
      }

      case 'PAYMENT_FAILED_WEBHOOK': {
        // The order is left where it is on purpose: the buyer can retry payment
        // against the same order, and cancelling it here would strand the cart.
        await this.orderTransitions.setPaymentStatus(manager, order.id, PaymentStatus.FAILED);
        return { relatedEntityId: order.id, result: 'processed' };
      }

      default: {
        this.logger.log(`Cashfree event ${payload.type} recorded without action`);
        return { relatedEntityId: order.id, result: 'ignored' };
      }
    }
  }

  private async applyDelhivery(
    manager: EntityManager,
    payload: DelhiveryWebhookPayload,
  ): Promise<{ relatedEntityId: string | null; result: WebhookOutcome }> {
    const { AWB, Status } = payload.Shipment;
    const order = await manager.findOne(Order, { where: { delhiveryWaybill: AWB } });

    if (!order) {
      this.logger.warn(`No order matches Delhivery waybill ${AWB}`);
      return { relatedEntityId: null, result: 'unmatched' };
    }

    const statusType = (Status.StatusType ?? '').toUpperCase();
    const target = DELHIVERY_STATUS_TYPE_MAP[statusType];

    if (!target) {
      this.logger.log(`Delhivery status ${statusType || '(none)'} recorded without action`);
      return { relatedEntityId: order.id, result: 'ignored' };
    }

    const { changed } = await this.orderTransitions.transition(manager, order.id, target, {
      cancellationReason:
        target === OrderStatus.CANCELLED ? `Delhivery ${statusType}` : undefined,
    });

    /**
     * The referral payout, in this same transaction (@GUARD Risk #1).
     *
     * Gated on `changed` so only the transition that actually delivered the
     * order pays out — a second `DL` scan is a no-op and must not re-enter here,
     * quite apart from the unique constraint that would already have stopped it.
     */
    if (changed && target === OrderStatus.DELIVERED) {
      const credit = await this.walletCredit.creditReferralForDeliveredOrder(manager, order.id);
      this.logger.log(`Referral settlement for order ${order.orderNumber}: ${credit.outcome}`);
    }

    return { relatedEntityId: order.id, result: 'processed' };
  }
}
