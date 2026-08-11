import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { IllegalOrderTransitionError } from './order-state-machine';
import { OrderTransitionService } from './order-transition.service';
import { OrderStatus, PaymentStatus } from '../../../common/enums/domain.enums';
import { Order } from '../../../database/entities/order.entity';

describe('OrderTransitionService', () => {
  let service: OrderTransitionService;
  let manager: { findOne: jest.Mock; save: jest.Mock };

  const order = (status: OrderStatus): Order =>
    ({ id: 'order-1', orderNumber: 'ADR-1', status }) as Order;

  beforeEach(async () => {
    manager = { findOne: jest.fn(), save: jest.fn((_e, v: unknown) => v) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderTransitionService],
    }).compile();

    service = module.get(OrderTransitionService);
  });

  it('takes a row lock before reading the current status', async () => {
    manager.findOne.mockResolvedValue(order(OrderStatus.CONFIRMED));

    await service.transition(manager as never, 'order-1', OrderStatus.SHIPPED);

    expect(manager.findOne).toHaveBeenCalledWith(Order, {
      where: { id: 'order-1' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('throws NotFound for an unknown order', async () => {
    manager.findOne.mockResolvedValue(null);

    await expect(
      service.transition(manager as never, 'missing', OrderStatus.SHIPPED),
    ).rejects.toThrow(NotFoundException);
  });

  it('applies a legal transition and stamps its timestamp', async () => {
    manager.findOne.mockResolvedValue(order(OrderStatus.CONFIRMED));

    const result = await service.transition(manager as never, 'order-1', OrderStatus.SHIPPED);

    expect(result.changed).toBe(true);
    expect(result.order.status).toBe(OrderStatus.SHIPPED);
    expect(result.order.shippedAt).toBeInstanceOf(Date);
    expect(manager.save).toHaveBeenCalled();
  });

  it.each([
    [OrderStatus.SHIPPED, OrderStatus.DELIVERED, 'deliveredAt'],
    [OrderStatus.CONFIRMED, OrderStatus.CANCELLED, 'cancelledAt'],
  ])('stamps %s -> %s on %s', async (from, to, field) => {
    manager.findOne.mockResolvedValue(order(from));

    const result = await service.transition(manager as never, 'order-1', to);

    expect(result.order[field as 'deliveredAt']).toBeInstanceOf(Date);
  });

  it('treats a repeat of the current status as a no-op instead of an error', async () => {
    manager.findOne.mockResolvedValue(order(OrderStatus.SHIPPED));

    const result = await service.transition(manager as never, 'order-1', OrderStatus.SHIPPED);

    expect(result.changed).toBe(false);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects an illegal transition rather than silently skipping it', async () => {
    manager.findOne.mockResolvedValue(order(OrderStatus.DELIVERED));

    await expect(
      service.transition(manager as never, 'order-1', OrderStatus.SHIPPED),
    ).rejects.toThrow(IllegalOrderTransitionError);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('applies the supplied patch alongside the transition', async () => {
    manager.findOne.mockResolvedValue(order(OrderStatus.ORDERED));

    const result = await service.transition(manager as never, 'order-1', OrderStatus.CONFIRMED, {
      paymentStatus: PaymentStatus.PAID,
    });

    expect(result.order.paymentStatus).toBe(PaymentStatus.PAID);
  });

  describe('setPaymentStatus', () => {
    it('records the payment result without moving the order', async () => {
      manager.findOne.mockResolvedValue(order(OrderStatus.ORDERED));

      const updated = await service.setPaymentStatus(
        manager as never,
        'order-1',
        PaymentStatus.FAILED,
      );

      expect(updated.paymentStatus).toBe(PaymentStatus.FAILED);
      expect(updated.status).toBe(OrderStatus.ORDERED);
    });

    it('throws NotFound for an unknown order', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(
        service.setPaymentStatus(manager as never, 'missing', PaymentStatus.FAILED),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
