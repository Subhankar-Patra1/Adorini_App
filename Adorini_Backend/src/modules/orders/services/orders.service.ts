import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type EntityManager } from 'typeorm';

import { canTransition } from './order-state-machine';
import { OrderTransitionService } from './order-transition.service';
import { OrderStatus, PaymentStatus } from '../../../common/enums/domain.enums';
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
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem) private readonly orderItems: Repository<OrderItem>,
    private readonly transitions: OrderTransitionService,
    private readonly dataSource: DataSource,
  ) {}

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

      await this.transitions.transition(manager, order.id, OrderStatus.CANCELLED, {
        cancellationReason: reason ?? 'Cancelled by customer',
      });

      await this.restock(manager, order.id);

      if (order.walletCreditPaise > 0) {
        await this.refundWalletCredit(manager, order);
      }
    });

    return this.getDetail(userId, orderId);
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
