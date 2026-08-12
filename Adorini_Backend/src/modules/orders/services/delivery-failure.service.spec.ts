import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { DeliveryFailureService } from './delivery-failure.service';
import { OrderTransitionService } from './order-transition.service';
import { OrdersService } from './orders.service';
import { OrderStatus } from '../../../common/enums/domain.enums';
import { Order } from '../../../database/entities/order.entity';
import { User } from '../../../database/entities/user.entity';
import { LogisticsService } from '../../../providers/logistics/logistics.service';
import { SmsService } from '../../../providers/sms/sms.service';

const CONFIG: Record<string, unknown> = {
  DELIVERY_RESPONSE_WINDOW_HOURS: 24,
  MAX_DELIVERY_ATTEMPTS: 3,
  MSG91_DELIVERY_RETRY_TEMPLATE: 'adorini_delivery_retry',
};

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    orderNumber: 'ADR-1',
    userId: 'user-1',
    status: OrderStatus.DELIVERY_FAILED,
    deliveryAttempts: 1,
    lastDeliveryFailedAt: new Date('2026-08-12T10:00:00.000Z'),
    delhiveryWaybill: 'AWB-1',
    walletCreditPaise: 0,
    ...overrides,
  } as Order;
}

describe('DeliveryFailureService', () => {
  let service: DeliveryFailureService;
  let ordersRepo: { find: jest.Mock; findOne: jest.Mock };
  let usersRepo: { findOne: jest.Mock; findOneByOrFail: jest.Mock };
  let transitions: { transition: jest.Mock };
  let ordersService: { performCancellation: jest.Mock };
  let logistics: { requestReattempt: jest.Mock };
  let sms: { whatsappNotify: jest.Mock };
  let manager: { findOne: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    ordersRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() };
    usersRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'user-1', phone: '919876543210' }),
      findOneByOrFail: jest.fn().mockResolvedValue({ id: 'user-1', phone: '919876543210' }),
    };
    transitions = { transition: jest.fn().mockResolvedValue({ order: order(), changed: true }) };
    ordersService = { performCancellation: jest.fn() };
    logistics = { requestReattempt: jest.fn().mockResolvedValue(undefined) };
    sms = { whatsappNotify: jest.fn().mockResolvedValue(undefined) };
    manager = { findOne: jest.fn(), save: jest.fn((_e: unknown, v: unknown) => v) };
    dataSource = { transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryFailureService,
        { provide: getRepositoryToken(Order), useValue: ordersRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: OrderTransitionService, useValue: transitions },
        { provide: OrdersService, useValue: ordersService },
        { provide: LogisticsService, useValue: logistics },
        { provide: SmsService, useValue: sms },
        { provide: DataSource, useValue: dataSource },
        { provide: ConfigService, useValue: { get: jest.fn((k: string) => CONFIG[k]) } },
      ],
    }).compile();

    service = module.get(DeliveryFailureService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('recordFailedAttempt', () => {
    it('transitions to DELIVERY_FAILED and increments the attempt counter', async () => {
      const failing = order({ status: OrderStatus.SHIPPED, deliveryAttempts: 0 });
      transitions.transition.mockResolvedValue({ order: failing, changed: true });

      const result = await service.recordFailedAttempt(manager as never, 'order-1');

      expect(transitions.transition).toHaveBeenCalledWith(
        manager,
        'order-1',
        OrderStatus.DELIVERY_FAILED,
      );
      expect(result.deliveryAttempts).toBe(1);
      expect(result.lastDeliveryFailedAt).toBeInstanceOf(Date);
    });

    it('runs on the caller’s transaction, opening none of its own', async () => {
      transitions.transition.mockResolvedValue({ order: order(), changed: true });

      await service.recordFailedAttempt(manager as never, 'order-1');

      // Must stay inside the webhook's idempotent transaction, or a redelivered
      // webhook could double-count the attempt.
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('promptBuyer', () => {
    it('sends the WhatsApp template with the order number and window', async () => {
      await service.promptBuyer(order({ deliveryAttempts: 1 }));

      expect(sms.whatsappNotify).toHaveBeenCalledWith('919876543210', 'adorini_delivery_retry', {
        body_1: 'ADR-1',
        body_2: '24',
      });
    });

    it('sends nothing when the courier has no attempts left', async () => {
      // Offering a retry the courier will refuse would be a promise we cannot keep.
      await service.promptBuyer(order({ deliveryAttempts: 3 }));

      expect(sms.whatsappNotify).not.toHaveBeenCalled();
    });

    it('swallows a messaging failure rather than failing the webhook', async () => {
      // This runs after the webhook transaction committed; throwing here would
      // turn a correctly-recorded failure into a non-2xx Delhivery redelivers.
      sms.whatsappNotify.mockRejectedValue(new Error('MSG91 down'));

      await expect(service.promptBuyer(order())).resolves.toBeUndefined();
    });
  });

  describe('requestReattempt', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-12T12:00:00.000Z'));
    });

    it('puts an eligible order back into SHIPPED and asks Delhivery to retry', async () => {
      manager.findOne.mockResolvedValue(order());

      const outcome = await service.requestReattempt('order-1');

      expect(outcome).toEqual({ requested: true, orderNumber: 'ADR-1', attemptsUsed: 1 });
      expect(transitions.transition).toHaveBeenCalledWith(manager, 'order-1', OrderStatus.SHIPPED);
      expect(logistics.requestReattempt).toHaveBeenCalledWith('AWB-1');
    });

    it('locks the order row before deciding', async () => {
      manager.findOne.mockResolvedValue(order());

      await service.requestReattempt('order-1');

      expect(manager.findOne).toHaveBeenCalledWith(Order, {
        where: { id: 'order-1' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it.each([OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.CANCELLED])(
      'refuses an order in %s',
      async (status) => {
        manager.findOne.mockResolvedValue(order({ status }));

        const outcome = await service.requestReattempt('order-1');

        expect(outcome).toEqual({ requested: false, reason: 'NO_FAILED_ORDER' });
        expect(logistics.requestReattempt).not.toHaveBeenCalled();
      },
    );

    it('refuses once the courier’s attempts are exhausted', async () => {
      manager.findOne.mockResolvedValue(order({ deliveryAttempts: 3 }));

      const outcome = await service.requestReattempt('order-1');

      expect(outcome).toEqual({ requested: false, reason: 'ATTEMPTS_EXHAUSTED' });
    });

    it('refuses past the response window', async () => {
      jest.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
      manager.findOne.mockResolvedValue(order());

      const outcome = await service.requestReattempt('order-1');

      expect(outcome).toEqual({ requested: false, reason: 'WINDOW_EXPIRED' });
      expect(transitions.transition).not.toHaveBeenCalled();
    });

    it('still reports success when Delhivery rejects the reattempt', async () => {
      // The buyer has already been told we accepted; the order is back in
      // SHIPPED and the discrepancy is recoverable from Delhivery's tracking.
      manager.findOne.mockResolvedValue(order());
      logistics.requestReattempt.mockRejectedValue(new Error('Delhivery 503'));

      const outcome = await service.requestReattempt('order-1');

      expect(outcome.requested).toBe(true);
    });

    it('does not call Delhivery for an order with no waybill', async () => {
      manager.findOne.mockResolvedValue(order({ delhiveryWaybill: null }));

      const outcome = await service.requestReattempt('order-1');

      expect(outcome.requested).toBe(true);
      expect(logistics.requestReattempt).not.toHaveBeenCalled();
    });
  });

  describe('requestReattemptByPhone', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-12T12:00:00.000Z'));
    });

    it('resolves the buyer’s most recent failed order', async () => {
      ordersRepo.findOne.mockResolvedValue(order());
      manager.findOne.mockResolvedValue(order());

      const outcome = await service.requestReattemptByPhone('919876543210');

      expect(ordersRepo.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-1', status: OrderStatus.DELIVERY_FAILED },
        order: { lastDeliveryFailedAt: 'DESC' },
      });
      expect(outcome.requested).toBe(true);
    });

    it('reports no match for an unknown phone', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      const outcome = await service.requestReattemptByPhone('919000000000');

      expect(outcome).toEqual({ requested: false, reason: 'NO_FAILED_ORDER' });
    });

    it('reports no match when the buyer has no failed order', async () => {
      ordersRepo.findOne.mockResolvedValue(null);

      const outcome = await service.requestReattemptByPhone('919876543210');

      expect(outcome).toEqual({ requested: false, reason: 'NO_FAILED_ORDER' });
    });
  });

  describe('cancelUnanswered', () => {
    it('cancels without restocking — the parcel is still in transit back', async () => {
      ordersRepo.find.mockResolvedValue([{ id: 'order-1', orderNumber: 'ADR-1' }]);
      manager.findOne.mockResolvedValue(order());

      const cancelled = await service.cancelUnanswered();

      expect(cancelled).toBe(1);
      expect(ordersService.performCancellation).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ id: 'order-1' }),
        'No response to the delivery-retry prompt',
        { restockNow: false },
      );
    });

    it('skips an order the buyer answered in the meantime', async () => {
      ordersRepo.find.mockResolvedValue([{ id: 'order-1', orderNumber: 'ADR-1' }]);
      // Re-read under the lock shows it already moved back to SHIPPED.
      manager.findOne.mockResolvedValue(order({ status: OrderStatus.SHIPPED }));

      const cancelled = await service.cancelUnanswered();

      expect(cancelled).toBe(0);
      expect(ordersService.performCancellation).not.toHaveBeenCalled();
    });

    it('keeps sweeping when one order fails', async () => {
      ordersRepo.find.mockResolvedValue([
        { id: 'order-1', orderNumber: 'ADR-1' },
        { id: 'order-2', orderNumber: 'ADR-2' },
      ]);
      manager.findOne.mockResolvedValue(order());
      ordersService.performCancellation
        .mockRejectedValueOnce(new Error('lock timeout'))
        .mockResolvedValueOnce(undefined);

      const cancelled = await service.cancelUnanswered();

      expect(cancelled).toBe(1);
      expect(ordersService.performCancellation).toHaveBeenCalledTimes(2);
    });

    it('does nothing when nothing is overdue', async () => {
      ordersRepo.find.mockResolvedValue([]);

      expect(await service.cancelUnanswered()).toBe(0);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
