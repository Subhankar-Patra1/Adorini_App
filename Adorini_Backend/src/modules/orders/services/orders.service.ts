import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type EntityManager } from 'typeorm';

import { describeRetryOffer } from './delivery-window';
import { canTransition } from './order-state-machine';
import { OrderTransitionService } from './order-transition.service';
import { OrderStatus, PaymentStatus } from '../../../common/enums/domain.enums';
import type { Env } from '../../../config/env.validation';
import { Order, type ShippingAddressSnapshot } from '../../../database/entities/order.entity';
import { OrderItem } from '../../../database/entities/order-item.entity';
import { ProductVariant } from '../../../database/entities/product-variant.entity';
import { Wallet } from '../../../database/entities/wallet.entity';
import { WalletTransaction } from '../../../database/entities/wallet-transaction.entity';
import { WalletTransactionType } from '../../../common/enums/domain.enums';

/**
 * Statuses at which the buyer may still change where a parcel goes.
 *
 * The cut-off is dispatch. Once Delhivery has the parcel the label is printed
 * and the address on our record no longer decides anything — editing it then
 * would produce an order whose stored address is not where the goods went,
 * which is worse than refusing the edit.
 */
const ADDRESS_EDITABLE_STATUSES: readonly OrderStatus[] = [
  OrderStatus.ORDERED,
  OrderStatus.PENDING_VERIFICATION,
  OrderStatus.CONFIRMED,
];

export interface OrderLine {
  id: string;
  productId: string | null;
  productName: string;
  sku: string;
  nominalSize: number;
  colour: string;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: string;
  paymentStatus: PaymentStatus;
  totalPaise: number;
  itemCount: number;
  createdAt: string;
}

export interface OrderDetail extends OrderSummary {
  subtotalPaise: number;
  discountPaise: number;
  deliveryFeePaise: number;
  walletCreditPaise: number;
  shippingAddress: ShippingAddressSnapshot;
  delhiveryWaybill: string | null;
  codVerifiedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  items: OrderLine[];
  /** Whether the buyer can still change the delivery address. */
  canEditAddress: boolean;
  canCancel: boolean;
  deliveryAttempts: number;
  lastDeliveryFailedAt: string | null;
  /** Whether the app should offer "still want this? reschedule it" — see ADR-033. */
  canRequestReattempt: boolean;
  respondByIso: string | null;
  attemptsRemaining: number;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly maxDeliveryAttempts: number;
  private readonly deliveryResponseWindowHours: number;

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem) private readonly orderItems: Repository<OrderItem>,
    private readonly transitions: OrderTransitionService,
    private readonly dataSource: DataSource,
    config: ConfigService<Env, true>,
  ) {
    this.maxDeliveryAttempts = config.get('MAX_DELIVERY_ATTEMPTS', { infer: true });
    this.deliveryResponseWindowHours = config.get('DELIVERY_RESPONSE_WINDOW_HOURS', {
      infer: true,
    });
  }

  async list(userId: string, limit = 20, offset = 0): Promise<OrderSummary[]> {
    const rows = await this.orders.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    if (rows.length === 0) {
      return [];
    }

    // One grouped count rather than a query per order — an order history screen
    // is exactly where an N+1 would show up as a slow list.
    const counts = await this.orderItems
      .createQueryBuilder('item')
      .select('item.order_id', 'orderId')
      .addSelect('COALESCE(SUM(item.quantity), 0)', 'total')
      .where('item.order_id IN (:...ids)', { ids: rows.map((r) => r.id) })
      .groupBy('item.order_id')
      .getRawMany<{ orderId: string; total: string }>();

    const countByOrder = new Map(counts.map((c) => [c.orderId, Number(c.total)]));

    return rows.map((order) => this.toSummary(order, countByOrder.get(order.id) ?? 0));
  }

  async getDetail(userId: string, orderId: string): Promise<OrderDetail> {
    const order = await this.requireOwnedOrder(userId, orderId);
    const items = await this.orderItems.find({
      where: { orderId: order.id },
      order: { createdAt: 'ASC' },
    });

    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

    return {
      ...this.toSummary(order, itemCount),
      subtotalPaise: order.subtotalPaise,
      discountPaise: order.discountPaise,
      deliveryFeePaise: order.deliveryFeePaise,
      walletCreditPaise: order.walletCreditPaise,
      shippingAddress: order.shippingAddress,
      delhiveryWaybill: order.delhiveryWaybill,
      codVerifiedAt: order.codVerifiedAt?.toISOString() ?? null,
      shippedAt: order.shippedAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      cancellationReason: order.cancellationReason,
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        nominalSize: item.nominalSize,
        colour: item.colour,
        unitPricePaise: item.unitPricePaise,
        quantity: item.quantity,
        lineTotalPaise: item.lineTotalPaise,
      })),
      canEditAddress: ADDRESS_EDITABLE_STATUSES.includes(order.status),
      canCancel: canTransition(order.status, OrderStatus.CANCELLED),
      deliveryAttempts: order.deliveryAttempts,
      lastDeliveryFailedAt: order.lastDeliveryFailedAt?.toISOString() ?? null,
      // Computed from the shared helper rather than locally, so what the app
      // shows and what the reattempt endpoint will accept cannot disagree.
      ...describeRetryOffer({
        status: order.status,
        deliveryAttempts: order.deliveryAttempts,
        lastDeliveryFailedAt: order.lastDeliveryFailedAt,
        maxAttempts: this.maxDeliveryAttempts,
        responseWindowHours: this.deliveryResponseWindowHours,
      }),
    };
  }

  /**
   * Changes where an order is delivered.
   *
   * @GUARD Risk #2 (HIGH): the status is re-read **under a row lock inside the
   * transaction, immediately before the write** — never checked beforehand and
   * trusted.
   *
   * The race this closes: a buyer taps "change address" at the same moment
   * Delhivery's dispatch webhook arrives. Checking the status first and writing
   * afterwards leaves a window where the check passes, the order ships, and the
   * edit then lands on an order already in transit — so our record says one
   * address while the parcel is on its way to another. Support has no way to
   * tell which is real.
   *
   * Because the webhook's transition takes the same `FOR UPDATE` lock on the
   * same row, the two serialise: whichever arrives second sees the other's
   * committed result and is refused.
   */
  async updateShippingAddress(
    userId: string,
    orderId: string,
    address: ShippingAddressSnapshot,
  ): Promise<OrderDetail> {
    await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(Order, {
        where: { id: orderId, userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      // Evaluated with the lock held, so this cannot go stale between the check
      // and the save below.
      if (!ADDRESS_EDITABLE_STATUSES.includes(order.status)) {
        throw new ConflictException({
          code: 'ADDRESS_LOCKED',
          message:
            order.status === OrderStatus.SHIPPED
              ? 'This order has already been dispatched, so its address can no longer be changed.'
              : 'This order can no longer be changed.',
          status: order.status,
        });
      }

      order.shippingAddress = address;
      await manager.save(Order, order);

      this.logger.log(`Delivery address updated for ${order.orderNumber}`);
    });

    return this.getDetail(userId, orderId);
  }

  /**
   * Cancels an order at the buyer's request, refunding any store credit spent.
   *
   * The refund runs in the same transaction as the cancellation: a cancelled
   * order whose wallet credit was never returned is money quietly taken from a
   * customer, and it would only surface as a complaint.
   */
  async cancel(userId: string, orderId: string, reason?: string): Promise<OrderDetail> {
    await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(Order, {
        where: { id: orderId, userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      if (order.status === OrderStatus.SHIPPED) {
        // A dispatched parcel cannot be recalled by the buyer; it comes back as
        // a courier RTO, which arrives through the Delhivery webhook instead.
        throw new ConflictException({
          code: 'ALREADY_DISPATCHED',
          message: 'This order has already been dispatched and can no longer be cancelled here.',
        });
      }

      // Pre-dispatch by definition — the `SHIPPED` guard above rejects anything
      // already in a courier's hands — so the goods are still on our shelf and
      // can go straight back.
      await this.performCancellation(manager, order, reason ?? 'Cancelled by customer', {
        restockNow: true,
      });
    });

    return this.getDetail(userId, orderId);
  }

  /**
   * System-initiated cancellation for a COD order whose intent-verification
   * window expired — driven by the `jobs` sweep, not a buyer request.
   *
   * Deliberately not scoped by `userId`: there is no calling user, only a
   * background job with an order id. Re-checks the status under the same lock
   * `cancel()` uses, because the buyer may have verified or the order may have
   * already been cancelled in the gap between the sweep's query and this call
   * — the job runs on a timer, not inside a transaction with its selection.
   *
   * Returns `false` rather than throwing when there is nothing to do; an order
   * that resolved itself moments before the sweep reached it is the sweep
   * working as intended, not a fault.
   */
  async autoCancelUnverifiedCod(orderId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(Order, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!order || order.status !== OrderStatus.PENDING_VERIFICATION) {
        return false;
      }

      // Also pre-dispatch: an unverified COD order never shipped, so its stock
      // is still ours to release.
      await this.performCancellation(manager, order, 'COD verification window expired', {
        restockNow: true,
      });
      return true;
    });
  }

  /**
   * Puts a returned parcel's units back on the shelf.
   *
   * Called when Delhivery confirms an `RT` return-to-origin — **not** when the
   * order was cancelled. Between those two events the goods are physically in a
   * courier van, and restocking on cancellation would let us sell inventory
   * that is days from being sellable (ADR-034).
   *
   * Idempotent on `restockedAt`: couriers emit repeated scans, and putting the
   * same units back twice would invent inventory out of nothing.
   */
  async restockReturnedParcel(manager: EntityManager, orderId: string): Promise<boolean> {
    const order = await manager.findOne(Order, {
      where: { id: orderId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!order || order.restockedAt) {
      return false;
    }

    await this.restock(manager, order.id);

    // Targeted update for the same reason as in `performCancellation`: never
    // write a whole entity back when another write may have touched the row.
    await manager.update(Order, order.id, { restockedAt: new Date() });

    this.logger.log(`Returned parcel for ${order.orderNumber} restocked`);
    return true;
  }

  /**
   * The transition, the wallet refund, and — only when the goods are actually
   * ours to release — the stock restore. Shared by every cancellation path so
   * the refund step cannot be forgotten by one of them.
   *
   * `restockNow` is the whole reason this takes options rather than always
   * restocking: a pre-dispatch cancellation frees stock immediately, while a
   * parcel already with a courier does not come back until its return-to-origin
   * scan (ADR-034). A COD order can carry wallet credit either way, so the
   * refund is unconditional.
   */
  async performCancellation(
    manager: EntityManager,
    order: Order,
    reason: string,
    options: { restockNow: boolean },
  ): Promise<void> {
    await this.transitions.transition(manager, order.id, OrderStatus.CANCELLED, {
      cancellationReason: reason,
    });

    if (options.restockNow) {
      await this.restock(manager, order.id);

      /**
       * A targeted column update, **not** `manager.save(Order, order)`.
       *
       * `transition` above loaded and saved its own copy of this row, so the
       * `order` object handed to this method is now stale — saving it would
       * write its pre-transition `status` back over the `CANCELLED` the
       * transition just committed, silently un-cancelling the order. An
       * integration test caught exactly that; the unit tests could not, because
       * a mocked `save` does not model last-write-wins on a real row.
       */
      await manager.update(Order, order.id, { restockedAt: new Date() });
    }

    if (order.walletCreditPaise > 0) {
      await this.refundWalletCredit(manager, order);
    }
  }

  /** Returns reserved units to the shelf so a cancelled order stops holding stock. */
  private async restock(manager: EntityManager, orderId: string): Promise<void> {
    const items = await manager.find(OrderItem, { where: { orderId } });

    for (const item of items) {
      if (!item.variantId) {
        // The variant was retired after the order was placed; there is no shelf
        // left to return it to.
        continue;
      }

      await manager
        .createQueryBuilder()
        .update(ProductVariant)
        .set({ stockQuantity: () => `"stock_quantity" + ${item.quantity}` })
        .where('id = :id', { id: item.variantId })
        .execute();
    }
  }

  private async refundWalletCredit(manager: EntityManager, order: Order): Promise<void> {
    const wallet = await manager.findOne(Wallet, {
      where: { userId: order.userId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!wallet) {
      this.logger.error(
        `Order ${order.orderNumber} spent wallet credit but its wallet is missing; refund skipped`,
      );
      return;
    }

    wallet.balancePaise += order.walletCreditPaise;
    await manager.save(Wallet, wallet);

    await manager.save(
      WalletTransaction,
      manager.create(WalletTransaction, {
        walletId: wallet.id,
        type: WalletTransactionType.REFUND_CREDIT,
        amountPaise: order.walletCreditPaise,
        balanceAfterPaise: wallet.balancePaise,
        referenceId: order.id,
        description: `Refund for cancelled order ${order.orderNumber}`,
      }),
    );
  }

  /** Scoped by userId in the query — another buyer's order is a 404, not a 403. */
  private async requireOwnedOrder(userId: string, orderId: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id: orderId, userId } });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  private toSummary(order: Order, itemCount: number): OrderSummary {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      totalPaise: order.totalPaise,
      itemCount,
      createdAt: order.createdAt.toISOString(),
    };
  }
}
