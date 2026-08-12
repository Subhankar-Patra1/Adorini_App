import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { OrdersService } from './orders.service';
import { OrderTransitionService } from './order-transition.service';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  WalletTransactionType,
} from '../../../common/enums/domain.enums';
import { Order } from '../../../database/entities/order.entity';
import { OrderItem } from '../../../database/entities/order-item.entity';
import { ProductVariant } from '../../../database/entities/product-variant.entity';
import { Wallet } from '../../../database/entities/wallet.entity';
import { WalletTransaction } from '../../../database/entities/wallet-transaction.entity';

/**
 * Focused on `cancel` and `autoCancelUnverifiedCod`, which share a private
 * `performCancellation` helper — the part this change touched. `list` and
 * `getDetail` are untouched read paths with no coverage of their own yet;
 * adding it here would be unrelated scope.
 */
describe('OrdersService — cancellation', () => {
  let service: OrdersService;
  let transitions: { transition: jest.Mock };
  let manager: {
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let updateQb: { update: jest.Mock; set: jest.Mock; where: jest.Mock; execute: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  const order = (overrides: Partial<Order> = {}): Order =>
    ({
      id: 'order-1',
      orderNumber: 'ADR-1',
      userId: 'user-1',
      status: OrderStatus.CONFIRMED,
      paymentMethod: PaymentMethod.COD,
      paymentStatus: PaymentStatus.PENDING,
      walletCreditPaise: 0,
      ...overrides,
    }) as Order;

  beforeEach(async () => {
    transitions = { transition: jest.fn().mockResolvedValue({ changed: true }) };

    updateQb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };

    manager = {
      findOne: jest.fn(),
      save: jest.fn((_entity: unknown, v: unknown) => Promise.resolve(v)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn((_entity: unknown, v: unknown) => v),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(updateQb),
    };

    dataSource = { transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: {} },
        { provide: getRepositoryToken(OrderItem), useValue: {} },
        { provide: OrderTransitionService, useValue: transitions },
        { provide: DataSource, useValue: dataSource },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (key: string) =>
                ({ MAX_DELIVERY_ATTEMPTS: 3, DELIVERY_RESPONSE_WINDOW_HOURS: 24 })[key],
            ),
          },
        },
      ],
    }).compile();

    service = module.get(OrdersService);
    // `getDetail` is called after every mutation to build the response; both
    // read paths it touches are stubbed here since this suite is about the
    // write path, not the read shape.
    jest.spyOn(service, 'getDetail').mockResolvedValue({} as never);
  });

  describe('cancel', () => {
    it('throws NotFound for another user’s order', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(service.cancel('user-1', 'order-1')).rejects.toThrow(NotFoundException);
    });

    it('refuses to cancel a dispatched order', async () => {
      manager.findOne.mockResolvedValue(order({ status: OrderStatus.SHIPPED }));

      await expect(service.cancel('user-1', 'order-1')).rejects.toThrow(ConflictException);
      expect(transitions.transition).not.toHaveBeenCalled();
    });

    it('transitions to CANCELLED with the given reason', async () => {
      manager.findOne.mockResolvedValue(order());

      await service.cancel('user-1', 'order-1', 'Changed my mind');

      expect(transitions.transition).toHaveBeenCalledWith(
        manager,
        'order-1',
        OrderStatus.CANCELLED,
        { cancellationReason: 'Changed my mind' },
      );
    });

    it('defaults the reason when the buyer gives none', async () => {
      manager.findOne.mockResolvedValue(order());

      await service.cancel('user-1', 'order-1');

      expect(transitions.transition).toHaveBeenCalledWith(
        manager,
        'order-1',
        OrderStatus.CANCELLED,
        { cancellationReason: 'Cancelled by customer' },
      );
    });

    it('restocks each item carrying a variant', async () => {
      manager.findOne.mockResolvedValue(order());
      manager.find.mockResolvedValue([
        { variantId: 'variant-1', quantity: 2 },
        { variantId: null, quantity: 1 }, // retired variant — nothing to restock
      ]);

      await service.cancel('user-1', 'order-1');

      expect(updateQb.update).toHaveBeenCalledWith(ProductVariant);
      expect(updateQb.where).toHaveBeenCalledWith('id = :id', { id: 'variant-1' });
      expect(updateQb.where).toHaveBeenCalledTimes(1);
    });

    it('refunds wallet credit spent on the order', async () => {
      manager.findOne
        .mockResolvedValueOnce(order({ walletCreditPaise: 5000 }))
        .mockResolvedValueOnce({ id: 'wallet-1', userId: 'user-1', balancePaise: 1000 });

      await service.cancel('user-1', 'order-1');

      expect(manager.save).toHaveBeenCalledWith(
        Wallet,
        expect.objectContaining({ balancePaise: 6000 }),
      );
      expect(manager.save).toHaveBeenCalledWith(
        WalletTransaction,
        expect.objectContaining({
          type: WalletTransactionType.REFUND_CREDIT,
          amountPaise: 5000,
          balanceAfterPaise: 6000,
          referenceId: 'order-1',
        }),
      );
    });

    it('skips the wallet refund when no credit was spent', async () => {
      manager.findOne.mockResolvedValue(order({ walletCreditPaise: 0 }));

      await service.cancel('user-1', 'order-1');

      expect(manager.save).not.toHaveBeenCalledWith(Wallet, expect.anything());
    });

    it('stamps restockedAt with a targeted update, never a whole-entity save', async () => {
      /**
       * Regression test. Writing the whole `Order` back here would clobber the
       * `CANCELLED` status that `transition` had just committed on its own copy
       * of the row, silently un-cancelling the order — an integration test
       * caught that, and this pins the shape that fixed it.
       */
      manager.findOne.mockResolvedValue(order());

      await service.cancel('user-1', 'order-1');

      expect(manager.update).toHaveBeenCalledWith(
        Order,
        'order-1',
        expect.objectContaining({ restockedAt: expect.any(Date) }),
      );
      expect(manager.save).not.toHaveBeenCalledWith(Order, expect.anything());
    });
  });

  describe('autoCancelUnverifiedCod', () => {
    it('cancels an order still awaiting COD verification', async () => {
      manager.findOne.mockResolvedValue(order({ status: OrderStatus.PENDING_VERIFICATION }));

      const result = await service.autoCancelUnverifiedCod('order-1');

      expect(result).toBe(true);
      expect(transitions.transition).toHaveBeenCalledWith(
        manager,
        'order-1',
        OrderStatus.CANCELLED,
        { cancellationReason: 'COD verification window expired' },
      );
    });

    it('is a no-op, not an error, when the order already moved on', async () => {
      manager.findOne.mockResolvedValue(order({ status: OrderStatus.CONFIRMED }));

      const result = await service.autoCancelUnverifiedCod('order-1');

      expect(result).toBe(false);
      expect(transitions.transition).not.toHaveBeenCalled();
    });

    it('is a no-op when the order no longer exists', async () => {
      manager.findOne.mockResolvedValue(null);

      const result = await service.autoCancelUnverifiedCod('order-1');

      expect(result).toBe(false);
    });

    it('is not scoped by any user id — the caller is a background job', async () => {
      manager.findOne.mockResolvedValue(order({ status: OrderStatus.PENDING_VERIFICATION }));

      await service.autoCancelUnverifiedCod('order-1');

      expect(manager.findOne).toHaveBeenCalledWith(Order, {
        where: { id: 'order-1' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('still refunds wallet credit on a system-initiated cancellation', async () => {
      manager.findOne
        .mockResolvedValueOnce(
          order({ status: OrderStatus.PENDING_VERIFICATION, walletCreditPaise: 2000 }),
        )
        .mockResolvedValueOnce({ id: 'wallet-1', userId: 'user-1', balancePaise: 0 });

      await service.autoCancelUnverifiedCod('order-1');

      expect(manager.save).toHaveBeenCalledWith(
        WalletTransaction,
        expect.objectContaining({ type: WalletTransactionType.REFUND_CREDIT, amountPaise: 2000 }),
      );
    });
  });
});
