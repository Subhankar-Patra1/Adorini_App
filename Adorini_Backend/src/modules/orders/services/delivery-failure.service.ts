import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository, type EntityManager } from 'typeorm';

import { isResponseWindowExpired } from './delivery-window';
import { OrderTransitionService } from './order-transition.service';
import { OrdersService } from './orders.service';
import { OrderStatus } from '../../../common/enums/domain.enums';
import { maskPhone } from '../../../common/utils/phone.util';
import type { Env } from '../../../config/env.validation';
import { Order } from '../../../database/entities/order.entity';
import { User } from '../../../database/entities/user.entity';
import { LogisticsService } from '../../../providers/logistics/logistics.service';
import { SmsService } from '../../../providers/sms/sms.service';

export type ReattemptOutcome =
  | { requested: true; orderNumber: string; attemptsUsed: number }
  | { requested: false; reason: 'NO_FAILED_ORDER' | 'WINDOW_EXPIRED' | 'ATTEMPTS_EXHAUSTED' };

/**
 * Everything that happens after a courier fails to hand a parcel over.
 *
 * The buyer-facing promise this implements: a failed delivery is **not** a
 * cancellation. We ask whether they still want it, and only cancel if they
 * decline or go quiet — because the common case is somebody who simply was not
 * home, and telling them their order is gone is both wrong and alarming
 * (ADR-033).
 *
 * Three entry points converge here so the rules live in one place: the
 * Delhivery webhook (attempt failed), an inbound WhatsApp reply (buyer wants
 * it again), and the scheduled sweep (nobody answered).
 */
@Injectable()
export class DeliveryFailureService {
  private readonly logger = new Logger(DeliveryFailureService.name);
  private readonly responseWindowHours: number;
  private readonly maxAttempts: number;
  private readonly retryTemplate: string;

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly transitions: OrderTransitionService,
    /**
     * For `performCancellation` — the shared transition + wallet-refund path.
     * The dependency is deliberately one-directional: `OrdersService` must not
     * inject this service back, or the module would not resolve. The order
     * detail route composes the two at the controller instead.
     */
    private readonly ordersService: OrdersService,
    private readonly logistics: LogisticsService,
    private readonly sms: SmsService,
    private readonly dataSource: DataSource,
    config: ConfigService<Env, true>,
  ) {
    this.responseWindowHours = config.get('DELIVERY_RESPONSE_WINDOW_HOURS', { infer: true });
    this.maxAttempts = config.get('MAX_DELIVERY_ATTEMPTS', { infer: true });
    this.retryTemplate = config.get('MSG91_DELIVERY_RETRY_TEMPLATE', { infer: true });
  }

  /**
   * Records a failed hand-over attempt, on the caller's transaction.
   *
   * Called from inside the Delhivery webhook's idempotent transaction, so it
   * takes an `EntityManager` rather than opening its own — a redelivered
   * webhook must not be able to increment the attempt counter twice.
   *
   * Returns the order so the caller can fire the WhatsApp prompt *after* its
   * transaction commits. Messaging a buyer about a state change that then rolls
   * back would be worse than not messaging at all.
   */
  async recordFailedAttempt(manager: EntityManager, orderId: string): Promise<Order> {
    const { order } = await this.transitions.transition(
      manager,
      orderId,
      OrderStatus.DELIVERY_FAILED,
    );

    order.deliveryAttempts += 1;
    order.lastDeliveryFailedAt = new Date();
    await manager.save(Order, order);

    this.logger.log(`Delivery attempt ${order.deliveryAttempts} failed for ${order.orderNumber}`);

    return order;
  }

  /**
   * Asks the buyer, over WhatsApp, whether they still want the parcel.
   *
   * Deliberately never throws: this runs after the webhook transaction has
   * committed, and MSG91 being unreachable must not turn a correctly-recorded
   * delivery failure into a failed webhook that Delhivery then redelivers. The
   * buyer can still act from the app, and the sweep still protects the stock.
   */
  async promptBuyer(order: Order): Promise<void> {
    if (order.deliveryAttempts >= this.maxAttempts) {
      // Nothing to offer — the courier will not try again, so asking would
      // promise something we cannot deliver.
      this.logger.log(`No reattempt left for ${order.orderNumber}; skipping the retry prompt`);
      return;
    }

    try {
      const user = await this.users.findOneByOrFail({ id: order.userId });

      await this.sms.whatsappNotify(user.phone, this.retryTemplate, {
        body_1: order.orderNumber,
        body_2: String(this.responseWindowHours),
      });

      this.logger.log(
        `Delivery-retry prompt sent for ${order.orderNumber} to ${maskPhone(user.phone)}`,
      );
    } catch (error) {
      this.logger.error(`Could not send the delivery-retry prompt for ${order.orderNumber}`, error);
    }
  }

  /**
   * The buyer says they still want it — put the parcel back in transit.
   *
   * Resolved by phone rather than order id because an inbound WhatsApp reply
   * carries no order reference. The most recent failed order wins: a buyer with
   * two failed parcels replying "yes" almost certainly means the one they were
   * just messaged about, and asking them to disambiguate over WhatsApp would
   * defeat the point of a one-tap reply.
   */
  async requestReattemptByPhone(phone: string): Promise<ReattemptOutcome> {
    const user = await this.users.findOne({ where: { phone } });

    if (!user) {
      return { requested: false, reason: 'NO_FAILED_ORDER' };
    }

    const order = await this.orders.findOne({
      where: { userId: user.id, status: OrderStatus.DELIVERY_FAILED },
      order: { lastDeliveryFailedAt: 'DESC' },
    });

    if (!order) {
      return { requested: false, reason: 'NO_FAILED_ORDER' };
    }

    return this.requestReattempt(order.id);
  }

  /**
   * Puts a failed parcel back in transit, if it is still eligible.
   *
   * Both guards are re-checked here under the row lock rather than trusted from
   * whatever called in: the sweep may have cancelled the order moments earlier,
   * and a reply arriving one second past the window is a real race, not a
   * hypothetical one.
   */
  async requestReattempt(orderId: string): Promise<ReattemptOutcome> {
    const result = await this.dataSource.transaction<
      ReattemptOutcome & { waybill?: string | null }
    >(async (manager) => {
      const order = await manager.findOne(Order, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!order || order.status !== OrderStatus.DELIVERY_FAILED) {
        return { requested: false, reason: 'NO_FAILED_ORDER' };
      }

      if (order.deliveryAttempts >= this.maxAttempts) {
        return { requested: false, reason: 'ATTEMPTS_EXHAUSTED' };
      }

      if (isResponseWindowExpired(order.lastDeliveryFailedAt, this.responseWindowHours)) {
        return { requested: false, reason: 'WINDOW_EXPIRED' };
      }

      await this.transitions.transition(manager, order.id, OrderStatus.SHIPPED);

      return {
        requested: true,
        orderNumber: order.orderNumber,
        attemptsUsed: order.deliveryAttempts,
        waybill: order.delhiveryWaybill,
      };
    });

    /**
     * The courier call happens after the commit, for the same reason the
     * WhatsApp prompt does: an external timeout must not roll back a decision
     * the buyer has already been told we accepted. If it fails, the order is
     * back in `SHIPPED` and reconciliation against Delhivery's own tracking
     * will catch the discrepancy — a stuck-in-transit order is recoverable,
     * whereas telling a buyer "yes, we'll retry" and then silently not trying
     * is not.
     */
    if (result.requested) {
      if (result.waybill) {
        try {
          await this.logistics.requestReattempt(result.waybill);
        } catch (error) {
          this.logger.error(
            `Order ${result.orderNumber} was set back to SHIPPED but Delhivery would not accept the reattempt`,
            error,
          );
        }
      } else {
        this.logger.error(
          `Order ${result.orderNumber} has no waybill; cannot ask Delhivery to reattempt`,
        );
      }

      return {
        requested: true,
        orderNumber: result.orderNumber,
        attemptsUsed: result.attemptsUsed,
      };
    }

    return result;
  }

  /**
   * Cancels the failed deliveries nobody answered for.
   *
   * Driven by the `jobs` sweep. Restocking is deliberately **not** done here —
   * the goods are in a van heading back to the warehouse, not on the shelf, so
   * releasing the stock now would let us sell what we do not yet have. The
   * parcel's `RT` return-to-origin webhook is what restocks it (ADR-034).
   */
  async cancelUnanswered(): Promise<number> {
    const cutoff = new Date(Date.now() - this.responseWindowHours * 60 * 60 * 1000);

    const expired = await this.orders.find({
      where: {
        status: OrderStatus.DELIVERY_FAILED,
        lastDeliveryFailedAt: LessThan(cutoff),
      },
      select: { id: true, orderNumber: true },
    });

    let cancelled = 0;

    for (const candidate of expired) {
      try {
        await this.dataSource.transaction(async (manager) => {
          const order = await manager.findOne(Order, {
            where: { id: candidate.id },
            lock: { mode: 'pessimistic_write' },
          });

          // Re-checked under the lock: the buyer may have replied in the gap
          // between the query above and this order's turn.
          if (!order || order.status !== OrderStatus.DELIVERY_FAILED) {
            return;
          }

          /**
           * `restockNow: false` — the parcel is with the courier, heading back.
           * Its `RT` return-to-origin webhook is what puts the units back on the
           * shelf. Any wallet credit is still refunded here, by the shared path.
           */
          await this.ordersService.performCancellation(
            manager,
            order,
            'No response to the delivery-retry prompt',
            { restockNow: false },
          );

          cancelled++;
        });
      } catch (error) {
        // One stuck row must not stop the sweep reaching the rest.
        this.logger.error(`Failed to cancel unanswered order ${candidate.orderNumber}`, error);
      }
    }

    if (expired.length > 0) {
      this.logger.log(`Delivery-response sweep: cancelled ${cancelled}/${expired.length}`);
    }

    return cancelled;
  }
}
