import { Test, TestingModule } from '@nestjs/testing';

import { WebhookIdempotencyService } from './webhook-idempotency.service';
import { WebhooksService } from './webhooks.service';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  WebhookProvider,
} from '../../../common/enums/domain.enums';
import { Order } from '../../../database/entities/order.entity';
import { OrderTransitionService } from '../../orders/services/order-transition.service';
import { WalletCreditService } from '../../wallet/services/wallet-credit.service';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let manager: { findOne: jest.Mock };
  let idempotency: { ingest: jest.Mock };
  let transitions: { transition: jest.Mock; setPaymentStatus: jest.Mock };
  let walletCredit: { creditReferralForDeliveredOrder: jest.Mock };

  /** Runs the apply callback inline so the handler's real logic is exercised. */
  function passThroughIngest() {
    idempotency.ingest.mockImplementation(
      async (
        _event: unknown,
        apply: (m: typeof manager) => Promise<{ result: unknown }>,
      ) => {
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: WebhookIdempotencyService, useValue: idempotency },
        { provide: OrderTransitionService, useValue: transitions },
        { provide: WalletCreditService, useValue: walletCredit },
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

      await service.handleCashfree(payload('PAYMENT_SUCCESS_WEBHOOK', 98765) as never);

      expect(idempotency.ingest).toHaveBeenCalledWith(
        expect.objectContaining({ provider: WebhookProvider.CASHFREE, eventId: '98765' }),
        expect.any(Function),
      );
    });

    it('falls back to type:order_id when no payment id is supplied', async () => {
      manager.findOne.mockResolvedValue(order());

      await service.handleCashfree(payload('PAYMENT_USER_DROPPED_WEBHOOK') as never);

      expect(idempotency.ingest).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'PAYMENT_USER_DROPPED_WEBHOOK:cf-order-1' }),
        expect.any(Function),
      );
    });

    it('confirms a prepaid order on payment success', async () => {
      manager.findOne.mockResolvedValue(order({ paymentMethod: PaymentMethod.UPI }));

      const outcome = await service.handleCashfree(
        payload('PAYMENT_SUCCESS_WEBHOOK', 1) as never,
      );

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

      await service.handleCashfree(payload('PAYMENT_SUCCESS_WEBHOOK', 1) as never);

      expect(transitions.transition).toHaveBeenCalledWith(
        manager,
        'order-1',
        OrderStatus.PENDING_VERIFICATION,
        { paymentStatus: PaymentStatus.PAID },
      );
    });

    it('records a failed payment without moving the order', async () => {
      manager.findOne.mockResolvedValue(order());

      await service.handleCashfree(payload('PAYMENT_FAILED_WEBHOOK', 2) as never);

      expect(transitions.setPaymentStatus).toHaveBeenCalledWith(
        manager,
        'order-1',
        PaymentStatus.FAILED,
      );
      expect(transitions.transition).not.toHaveBeenCalled();
    });

    it('reports unmatched when no order carries the Cashfree order id', async () => {
      manager.findOne.mockResolvedValue(null);

      const outcome = await service.handleCashfree(
        payload('PAYMENT_SUCCESS_WEBHOOK', 3) as never,
      );

      expect(outcome).toBe('unmatched');
      expect(transitions.transition).not.toHaveBeenCalled();
    });

    it('ignores event types it takes no action on', async () => {
      manager.findOne.mockResolvedValue(order());

      const outcome = await service.handleCashfree(payload('SOMETHING_ELSE', 4) as never);

      expect(outcome).toBe('ignored');
    });

    it('reports a duplicate straight through from the idempotency layer', async () => {
      idempotency.ingest.mockResolvedValue({ status: 'duplicate' });

      const outcome = await service.handleCashfree(
        payload('PAYMENT_SUCCESS_WEBHOOK', 5) as never,
      );

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

      await service.handleDelhivery(payload('UD') as never);

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

      await service.handleDelhivery(payload(statusType) as never);

      expect(transitions.transition).toHaveBeenCalledWith(
        manager,
        'order-1',
        expected,
        expect.anything(),
      );
    });

    it.each(['PP', 'UNKNOWN_CODE', ''])('records status %s without acting', async (statusType) => {
      manager.findOne.mockResolvedValue(order());

      const outcome = await service.handleDelhivery(payload(statusType) as never);

      expect(outcome).toBe('ignored');
      expect(transitions.transition).not.toHaveBeenCalled();
    });

    it('credits the referral in the same transaction on a real delivery', async () => {
      manager.findOne.mockResolvedValue(order({ status: OrderStatus.SHIPPED }));
      transitions.transition.mockResolvedValue({ order: order(), changed: true });

      await service.handleDelhivery(payload('DL') as never);

      expect(walletCredit.creditReferralForDeliveredOrder).toHaveBeenCalledWith(
        manager,
        'order-1',
      );
    });

    it('does not re-credit when the delivery transition was a no-op', async () => {
      manager.findOne.mockResolvedValue(order({ status: OrderStatus.DELIVERED }));
      transitions.transition.mockResolvedValue({ order: order(), changed: false });

      await service.handleDelhivery(payload('DL', '2026-08-12T09:00:00Z') as never);

      expect(walletCredit.creditReferralForDeliveredOrder).not.toHaveBeenCalled();
    });

    it('does not credit on a non-delivery transition', async () => {
      manager.findOne.mockResolvedValue(order({ status: OrderStatus.CONFIRMED }));

      await service.handleDelhivery(payload('UD') as never);

      expect(walletCredit.creditReferralForDeliveredOrder).not.toHaveBeenCalled();
    });

    it('reports unmatched for an unknown waybill', async () => {
      manager.findOne.mockResolvedValue(null);

      const outcome = await service.handleDelhivery(payload('DL') as never);

      expect(outcome).toBe('unmatched');
      expect(walletCredit.creditReferralForDeliveredOrder).not.toHaveBeenCalled();
    });
  });

  describe('handleMsg91', () => {
    it('records a delivery report with no state change', async () => {
      const outcome = await service.handleMsg91({ requestId: 'req-1' } as never);

      expect(outcome).toBe('processed');
      expect(idempotency.ingest).toHaveBeenCalledWith(
        expect.objectContaining({ provider: WebhookProvider.MSG91, eventId: 'req-1' }),
        expect.any(Function),
      );
      expect(transitions.transition).not.toHaveBeenCalled();
    });

    it('falls back to message_id for de-duplication', async () => {
      await service.handleMsg91({ message_id: 'msg-9' } as never);

      expect(idempotency.ingest).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'msg-9' }),
        expect.any(Function),
      );
    });
  });
});
