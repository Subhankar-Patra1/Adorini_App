import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { WebhookIdempotencyService } from './webhook-idempotency.service';
import { WebhooksService } from './webhooks.service';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  WebhookProvider,
} from '../../../common/enums/domain.enums';
import type { Order } from '../../../database/entities/order.entity';
import { DeliveryFailureService } from '../../orders/services/delivery-failure.service';
import { OrderTransitionService } from '../../orders/services/order-transition.service';
import { OrdersService } from '../../orders/services/orders.service';
import { WalletCreditService } from '../../wallet/services/wallet-credit.service';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let manager: { findOne: jest.Mock };
  let idempotency: { ingest: jest.Mock };
  let transitions: { transition: jest.Mock; setPaymentStatus: jest.Mock };
  let walletCredit: { creditReferralForDeliveredOrder: jest.Mock };
  let deliveryFailures: { recordFailedAttempt: jest.Mock; promptBuyer: jest.Mock };
  let orders: { restockReturnedParcel: jest.Mock };

  /** Runs the apply callback inline so the handler's real logic is exercised. */
  function passThroughIngest() {
    idempotency.ingest.mockImplementation(
      async (_event: unknown, apply: (m: typeof manager) => Promise<{ result: unknown }>) => {
        const applied = await apply(manager);
        return { status: 'processed', result: applied.result };
      },
    );
  }

  const order = (overrides: Partial<Order> = {}): Order =>
    ({
      id: 'order-1',
      orderNumber: 'ADR-1',
      status: OrderStatus.ORDERED,
      paymentMethod: PaymentMethod.UPI,
      ...overrides,
    }) as Order;

  beforeEach(async () => {
    manager = { findOne: jest.fn() };
    idempotency = { ingest: jest.fn() };
    transitions = {
      transition: jest.fn().mockResolvedValue({ order: order(), changed: true }),
      setPaymentStatus: jest.fn().mockResolvedValue(order()),
    };
    walletCredit = {
      creditReferralForDeliveredOrder: jest.fn().mockResolvedValue({ outcome: 'credited' }),
    };
    deliveryFailures = {
      recordFailedAttempt: jest
        .fn()
        .mockImplementation((_m: unknown, id: string) =>
          Promise.resolve(order({ id, status: OrderStatus.DELIVERY_FAILED, deliveryAttempts: 1 })),
        ),
      promptBuyer: jest.fn().mockResolvedValue(undefined),
    };
    orders = { restockReturnedParcel: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: WebhookIdempotencyService, useValue: idempotency },
        { provide: OrderTransitionService, useValue: transitions },
        { provide: WalletCreditService, useValue: walletCredit },
        { provide: DeliveryFailureService, useValue: deliveryFailures },
        { provide: OrdersService, useValue: orders },
      ],
    }).compile();

    service = module.get(WebhooksService);
    passThroughIngest();
  });

  describe('handleCashfree', () => {
    const payload = (type: string, cfPaymentId?: string | number) => ({
      type,
      data: {
        order: { order_id: 'cf-order-1' },
        ...(cfPaymentId === undefined ? {} : { payment: { cf_payment_id: cfPaymentId } }),
      },
    });

    it('de-duplicates on cf_payment_id when present', async () => {
      manager.findOne.mockResolvedValue(order());

      await service.handleCashfree(payload('PAYMENT_SUCCESS_WEBHOOK', 98765));

      expect(idempotency.ingest).toHaveBeenCalledWith(
        expect.objectContaining({ provider: WebhookProvider.CASHFREE, eventId: '98765' }),
        expect.any(Function),
      );
    });

    it('falls back to type:order_id when no payment id is supplied', async () => {
      manager.findOne.mockResolvedValue(order());

      await service.handleCashfree(payload('PAYMENT_USER_DROPPED_WEBHOOK'));

      expect(idempotency.ingest).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'PAYMENT_USER_DROPPED_WEBHOOK:cf-order-1' }),
        expect.any(Function),
      );
    });

    it('confirms a prepaid order on payment success', async () => {
      manager.findOne.mockResolvedValue(order({ paymentMethod: PaymentMethod.UPI }));

      const outcome = await service.handleCashfree(payload('PAYMENT_SUCCESS_WEBHOOK', 1));

      expect(outcome).toBe('processed');
      expect(transitions.transition).toHaveBeenCalledWith(
        manager,
        'order-1',
        OrderStatus.CONFIRMED,
        { paymentStatus: PaymentStatus.PAID },
      );
    });

    it('routes a COD order to intent verification rather than confirmed', async () => {
      manager.findOne.mockResolvedValue(order({ paymentMethod: PaymentMethod.COD }));

      await service.handleCashfree(payload('PAYMENT_SUCCESS_WEBHOOK', 1));

      expect(transitions.transition).toHaveBeenCalledWith(
        manager,
        'order-1',
        OrderStatus.PENDING_VERIFICATION,
        { paymentStatus: PaymentStatus.PAID },
      );
    });

    it('records a failed payment without moving the order', async () => {
      manager.findOne.mockResolvedValue(order());

      await service.handleCashfree(payload('PAYMENT_FAILED_WEBHOOK', 2));

      expect(transitions.setPaymentStatus).toHaveBeenCalledWith(
        manager,
        'order-1',
        PaymentStatus.FAILED,
      );
      expect(transitions.transition).not.toHaveBeenCalled();
    });

    it('reports unmatched when no order carries the Cashfree order id', async () => {
      manager.findOne.mockResolvedValue(null);

      const outcome = await service.handleCashfree(payload('PAYMENT_SUCCESS_WEBHOOK', 3));

      expect(outcome).toBe('unmatched');
      expect(transitions.transition).not.toHaveBeenCalled();
    });

    it('ignores event types it takes no action on', async () => {
      manager.findOne.mockResolvedValue(order());

      const outcome = await service.handleCashfree(payload('SOMETHING_ELSE', 4));

      expect(outcome).toBe('ignored');
    });

    it('reports a duplicate straight through from the idempotency layer', async () => {
      idempotency.ingest.mockResolvedValue({ status: 'duplicate' });

      const outcome = await service.handleCashfree(payload('PAYMENT_SUCCESS_WEBHOOK', 5));

      expect(outcome).toBe('duplicate');
      expect(transitions.transition).not.toHaveBeenCalled();
    });
  });

  describe('handleDelhivery', () => {
    const payload = (statusType: string, at = '2026-08-12T00:00:00Z') => ({
      Shipment: {
        AWB: 'AWB123',
        Status: { StatusType: statusType, Status: 'Some prose', StatusDateTime: at },
      },
    });

    it('builds an event id from waybill, timestamp and status', async () => {
      manager.findOne.mockResolvedValue(order({ status: OrderStatus.CONFIRMED }));

      await service.handleDelhivery(payload('UD'));

      expect(idempotency.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: WebhookProvider.DELHIVERY,
          eventId: 'AWB123:2026-08-12T00:00:00Z:UD',
        }),
        expect.any(Function),
      );
    });

    it.each([
      ['UD', OrderStatus.SHIPPED],
      ['DL', OrderStatus.DELIVERED],
      ['RT', OrderStatus.CANCELLED],
      ['CN', OrderStatus.CANCELLED],
    ])('maps status type %s to %s', async (statusType, expected) => {
      manager.findOne.mockResolvedValue(order({ status: OrderStatus.CONFIRMED }));

      await service.handleDelhivery(payload(statusType));

      expect(transitions.transition).toHaveBeenCalledWith(
        manager,
        'order-1',
        expected,
        expect.anything(),
      );
    });

    it.each(['PP', 'UNKNOWN_CODE', ''])('records status %s without acting', async (statusType) => {
      manager.findOne.mockResolvedValue(order());

      const outcome = await service.handleDelhivery(payload(statusType));

      expect(outcome).toBe('ignored');
      expect(transitions.transition).not.toHaveBeenCalled();
    });

    it('credits the referral in the same transaction on a real delivery', async () => {
      manager.findOne.mockResolvedValue(order({ status: OrderStatus.SHIPPED }));
      transitions.transition.mockResolvedValue({ order: order(), changed: true });

      await service.handleDelhivery(payload('DL'));

      expect(walletCredit.creditReferralForDeliveredOrder).toHaveBeenCalledWith(manager, 'order-1');
    });

    it('does not re-credit when the delivery transition was a no-op', async () => {
      manager.findOne.mockResolvedValue(order({ status: OrderStatus.DELIVERED }));
      transitions.transition.mockResolvedValue({ order: order(), changed: false });

      await service.handleDelhivery(payload('DL', '2026-08-12T09:00:00Z'));

      expect(walletCredit.creditReferralForDeliveredOrder).not.toHaveBeenCalled();
    });

    it('does not credit on a non-delivery transition', async () => {
      manager.findOne.mockResolvedValue(order({ status: OrderStatus.CONFIRMED }));

      await service.handleDelhivery(payload('UD'));

      expect(walletCredit.creditReferralForDeliveredOrder).not.toHaveBeenCalled();
    });

    it('reports unmatched for an unknown waybill', async () => {
      manager.findOne.mockResolvedValue(null);

      const outcome = await service.handleDelhivery(payload('DL'));

      expect(outcome).toBe('unmatched');
      expect(walletCredit.creditReferralForDeliveredOrder).not.toHaveBeenCalled();
    });

    describe('failed hand-over attempts', () => {
      /** `UD` covers both ordinary transit and a failed attempt; the prose distinguishes them. */
      const attempt = (statusText: string, at = '2026-08-12T00:00:00Z') =>
        ({
          Shipment: {
            AWB: 'AWB123',
            Status: { StatusType: 'UD', Status: statusText, StatusDateTime: at },
          },
        }) as never;

      it.each([
        'Undelivered',
        'UNDELIVERED',
        'Consignee Not Available',
        'Customer Refused',
        'Refused by consignee',
      ])('records %j as a failed attempt', async (statusText) => {
        manager.findOne.mockResolvedValue(order({ status: OrderStatus.SHIPPED }));

        const outcome = await service.handleDelhivery(attempt(statusText));

        expect(outcome).toBe('processed');
        expect(deliveryFailures.recordFailedAttempt).toHaveBeenCalledWith(manager, 'order-1');
        // Never routed through the ordinary status map, which would have made
        // this a silent no-op on an already-SHIPPED order.
        expect(transitions.transition).not.toHaveBeenCalled();
      });

      it.each(['In Transit', 'Dispatched', 'Pending', 'Out for delivery'])(
        'treats %j as ordinary transit, not a failure',
        async (statusText) => {
          manager.findOne.mockResolvedValue(order({ status: OrderStatus.SHIPPED }));

          await service.handleDelhivery(attempt(statusText));

          expect(deliveryFailures.recordFailedAttempt).not.toHaveBeenCalled();
          expect(transitions.transition).toHaveBeenCalledWith(
            manager,
            'order-1',
            OrderStatus.SHIPPED,
            expect.anything(),
          );
        },
      );

      it('prompts the buyer after the transaction, not inside it', async () => {
        manager.findOne.mockResolvedValue(order({ status: OrderStatus.SHIPPED }));

        await service.handleDelhivery(attempt('Undelivered'));

        // Messaging a buyer about a state change that then rolled back would be
        // worse than not messaging at all.
        expect(deliveryFailures.promptBuyer).toHaveBeenCalledWith(
          expect.objectContaining({ status: OrderStatus.DELIVERY_FAILED }),
        );
      });

      it('ignores a repeat scan of an attempt already recorded', async () => {
        manager.findOne.mockResolvedValue(order({ status: OrderStatus.DELIVERY_FAILED }));

        const outcome = await service.handleDelhivery(attempt('Undelivered', '2026-08-12T09:00Z'));

        expect(outcome).toBe('ignored');
        // Would otherwise inflate the attempt counter and re-prompt the buyer.
        expect(deliveryFailures.recordFailedAttempt).not.toHaveBeenCalled();
        expect(deliveryFailures.promptBuyer).not.toHaveBeenCalled();
      });

      it('does not prompt on a duplicate webhook', async () => {
        idempotency.ingest.mockResolvedValue({ status: 'duplicate' });

        await service.handleDelhivery(attempt('Undelivered'));

        expect(deliveryFailures.promptBuyer).not.toHaveBeenCalled();
      });
    });

    describe('return to origin', () => {
      it('restocks the parcel once it is physically back', async () => {
        manager.findOne.mockResolvedValue(order({ status: OrderStatus.SHIPPED }));

        await service.handleDelhivery(payload('RT'));

        expect(transitions.transition).toHaveBeenCalledWith(
          manager,
          'order-1',
          OrderStatus.CANCELLED,
          expect.anything(),
        );
        expect(orders.restockReturnedParcel).toHaveBeenCalledWith(manager, 'order-1');
      });

      it('still restocks when the sweep already cancelled the order days earlier', async () => {
        // The transition is a no-op by then, but the goods still need putting
        // back — restocking must not be gated on `changed`.
        manager.findOne.mockResolvedValue(order({ status: OrderStatus.CANCELLED }));
        transitions.transition.mockResolvedValue({ order: order(), changed: false });

        await service.handleDelhivery(payload('RT'));

        expect(orders.restockReturnedParcel).toHaveBeenCalledWith(manager, 'order-1');
      });

      it('does not restock on a delivery', async () => {
        manager.findOne.mockResolvedValue(order({ status: OrderStatus.SHIPPED }));

        await service.handleDelhivery(payload('DL'));

        expect(orders.restockReturnedParcel).not.toHaveBeenCalled();
      });
    });
  });
});
