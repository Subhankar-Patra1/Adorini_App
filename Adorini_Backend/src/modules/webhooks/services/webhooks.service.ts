import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { WebhookIdempotencyService } from './webhook-idempotency.service';
import { OrderStatus, PaymentStatus, WebhookProvider } from '../../../common/enums/domain.enums';
import { Order } from '../../../database/entities/order.entity';
import { DeliveryFailureService } from '../../orders/services/delivery-failure.service';
import { statusAfterSuccessfulPayment } from '../../orders/services/order-state-machine';
import { OrderTransitionService } from '../../orders/services/order-transition.service';
import { OrdersService } from '../../orders/services/orders.service';
import { WalletCreditService } from '../../wallet/services/wallet-credit.service';
import type { CashfreeWebhookPayload, DelhiveryWebhookPayload } from '../dto/webhook-payloads.dto';

/** What the endpoint reports back. Every value is answered with a 2xx — see the controller. */
export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored' | 'unmatched';

/**
 * The Delhivery handler's result, carrying any work that must happen *after*
 * the idempotent transaction commits.
 *
 * `promptOrder` is threaded through the return value rather than stored on the
 * service because this is a singleton serving concurrent webhooks — instance
 * state would leak one request's order into another request's prompt.
 */
interface DelhiveryApplyResult {
  outcome: WebhookOutcome;
  promptOrder?: Order;
}

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

/**
 * `Status` values (the prose field, not `StatusType`) that mean the courier
 * actually tried to hand the parcel over and could not.
 *
 * This distinction matters because Delhivery reports both "moving through the
 * network" and "attempted and failed" under the same `StatusType: UD`. Mapping
 * on `StatusType` alone — which is what this service did before — meant a
 * failed attempt on an already-`SHIPPED` order was a no-op, so nobody was ever
 * told and the stock stayed held indefinitely.
 *
 * Matched case-insensitively on a substring, because the prose varies by
 * account configuration ("Undelivered", "Consignee Not Available", "Customer
 * Refused"). Deliberately **not** used to distinguish *why* it failed: a buyer
 * who was out and a buyer who refused both get the same prompt, and the ones
 * who genuinely refused simply do not reply (ADR-033).
 *
 * ⚠️ Unverified against a live Delhivery account — confirm the exact prose on
 * the first real integration test. An unrecognised `UD` falls through to the
 * ordinary in-transit path, which is the safe direction to be wrong in.
 */
const FAILED_ATTEMPT_MARKERS = ['undeliver', 'not available', 'refus', 'declin', 'no response'];

function isFailedDeliveryAttempt(statusType: string, statusText: string): boolean {
  if (statusType !== 'UD') {
    return false;
  }

  const text = statusText.toLowerCase();
  return FAILED_ATTEMPT_MARKERS.some((marker) => text.includes(marker));
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly idempotency: WebhookIdempotencyService,
    private readonly orderTransitions: OrderTransitionService,
    private readonly walletCredit: WalletCreditService,
    private readonly deliveryFailures: DeliveryFailureService,
    private readonly orders: OrdersService,
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

    if (ingest.status === 'duplicate') {
      return 'duplicate';
    }

    /**
     * Fired after `ingest` resolves, which is after its transaction committed.
     *
     * Threaded back through the return value rather than held on the service:
     * this is a singleton handling concurrent webhooks, so instance state would
     * leak one request's order into another's prompt. `promptBuyer` swallows its
     * own failures, so an unreachable Meta WhatsApp API cannot turn a
     * correctly-recorded delivery failure into a non-2xx that Delhivery then
     * redelivers.
     */
    if (ingest.result.promptOrder) {
      await this.deliveryFailures.promptBuyer(ingest.result.promptOrder);
    }

    return ingest.result.outcome;
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
  ): Promise<{ relatedEntityId: string | null; result: DelhiveryApplyResult }> {
    const { AWB, Status } = payload.Shipment;
    const order = await manager.findOne(Order, { where: { delhiveryWaybill: AWB } });

    if (!order) {
      this.logger.warn(`No order matches Delhivery waybill ${AWB}`);
      return { relatedEntityId: null, result: { outcome: 'unmatched' } };
    }

    const statusType = (Status.StatusType ?? '').toUpperCase();

    /**
     * A failed hand-over attempt, handled before the ordinary status map.
     *
     * Recorded inside this transaction so a redelivered webhook cannot
     * double-count the attempt; the buyer prompt is fired by the controller
     * *after* the commit, because messaging someone about a state change that
     * then rolls back is worse than not messaging at all.
     */
    if (isFailedDeliveryAttempt(statusType, Status.Status ?? '')) {
      if (order.status === OrderStatus.DELIVERY_FAILED) {
        // Repeat scan of an attempt already recorded — the transition service
        // would treat it as a no-op anyway, but returning early keeps the
        // attempt counter honest.
        this.logger.log(`Order ${order.orderNumber} already awaiting a delivery decision`);
        return { relatedEntityId: order.id, result: { outcome: 'ignored' } };
      }

      const failed = await this.deliveryFailures.recordFailedAttempt(manager, order.id);

      return {
        relatedEntityId: order.id,
        result: { outcome: 'processed', promptOrder: failed },
      };
    }

    const target = DELHIVERY_STATUS_TYPE_MAP[statusType];

    if (!target) {
      this.logger.log(`Delhivery status ${statusType || '(none)'} recorded without action`);
      return { relatedEntityId: order.id, result: { outcome: 'ignored' } };
    }

    const { changed } = await this.orderTransitions.transition(manager, order.id, target, {
      cancellationReason: target === OrderStatus.CANCELLED ? `Delhivery ${statusType}` : undefined,
    });

    /**
     * The parcel is physically back with us, so its units are sellable again.
     *
     * This — not the cancellation — is the restock trigger for anything that
     * was already dispatched (ADR-034). Runs whether or not `changed` is true:
     * the order may already have been cancelled by the response-window sweep
     * days earlier, and the goods still need putting back.
     */
    if (statusType === 'RT') {
      const restocked = await this.orders.restockReturnedParcel(manager, order.id);
      if (restocked) {
        this.logger.log(`Returned parcel for ${order.orderNumber} put back on the shelf`);
      }
    }

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

    return { relatedEntityId: order.id, result: { outcome: 'processed' } };
  }
}
