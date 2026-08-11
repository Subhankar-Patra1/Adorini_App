import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { assertTransition } from './order-state-machine';
import { OrderStatus, PaymentStatus } from '../../../common/enums/domain.enums';
import { Order } from '../../../database/entities/order.entity';

export interface TransitionResult {
  order: Order;
  /** False when the order was already in the target status — a routine duplicate scan. */
  changed: boolean;
}

@Injectable()
export class OrderTransitionService {
  private readonly logger = new Logger(OrderTransitionService.name);

  /**
   * Moves an order to `target` inside the caller's transaction.
   *
   * Takes an `EntityManager` rather than opening its own transaction because
   * every caller needs the transition to succeed or fail *together* with
   * something else — the `processed_webhooks` row that makes it idempotent, the
   * wallet credit it triggers. A service that committed independently would
   * reintroduce exactly the partial-application problem @GUARD Risk #1 is about.
   */
  async transition(
    manager: EntityManager,
    orderId: string,
    target: OrderStatus,
    patch: Partial<Pick<Order, 'paymentStatus' | 'cancellationReason' | 'delhiveryWaybill'>> = {},
  ): Promise<TransitionResult> {
    /**
     * `SELECT ... FOR UPDATE` — the current status must be read under a row lock,
     * not read-then-write. Two Delhivery scans arriving together would otherwise
     * both observe `SHIPPED`, both consider `DELIVERED` legal, and both apply it.
     * This is also the lock the address editor contends for (@GUARD Risk #2).
     */
    const order = await manager.findOne(Order, {
      where: { id: orderId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    if (order.status === target) {
      this.logger.log(`Order ${order.orderNumber} already ${target}; treating as no-op`);
      return { order, changed: false };
    }

    assertTransition(order.status, target, order.id);

    order.status = target;
    Object.assign(order, patch);
    this.stampTimestamp(order, target);

    await manager.save(Order, order);
    this.logger.log(`Order ${order.orderNumber} -> ${target}`);

    return { order, changed: true };
  }

  /**
   * Records a payment outcome without moving the order.
   *
   * Used for terminal payment failures, where the order stays where it is and
   * only the payment result is worth keeping — the buyer can retry against the
   * same order.
   */
  async setPaymentStatus(
    manager: EntityManager,
    orderId: string,
    paymentStatus: PaymentStatus,
  ): Promise<Order> {
    const order = await manager.findOne(Order, {
      where: { id: orderId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    order.paymentStatus = paymentStatus;
    return manager.save(Order, order);
  }

  /** The status timestamps are set here so no caller can advance a status and forget one. */
  private stampTimestamp(order: Order, target: OrderStatus): void {
    const now = new Date();

    if (target === OrderStatus.SHIPPED) {
      order.shippedAt = now;
    } else if (target === OrderStatus.DELIVERED) {
      order.deliveredAt = now;
    } else if (target === OrderStatus.CANCELLED) {
      order.cancelledAt = now;
    }
  }
}
