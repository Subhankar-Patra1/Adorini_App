import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { FitTag, OrderStatus, ReturnStatus } from '../../../common/enums/domain.enums';
import { Order } from '../../../database/entities/order.entity';
import { OrderItem } from '../../../database/entities/order-item.entity';
import { ReturnRequest } from '../../../database/entities/return-request.entity';

const PG_UNIQUE_VIOLATION = '23505';

/**
 * The PRD's post-delivery return window.
 *
 * Measured from `deliveredAt` — the moment the buyer actually had the garment
 * in their hands — not from when the order was placed. Measuring from placement
 * would silently shrink the window by however long delivery took, so a slow
 * shipment would quietly cost the buyer their right to return.
 */
const RETURN_WINDOW_DAYS = 3;

export interface ReturnRequestView {
  id: string;
  orderId: string;
  orderNumber: string;
  orderItemId: string;
  productName: string;
  nominalSize: number;
  colour: string;
  quantity: number;
  reason: string;
  comment: string | null;
  fitTag: FitTag | null;
  status: ReturnStatus;
  adminNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface EligibleItem {
  orderItemId: string;
  productName: string;
  nominalSize: number;
  colour: string;
  quantity: number;
  /** False once a request already exists for this line. */
  isEligible: boolean;
  reasonIneligible: string | null;
}

@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    @InjectRepository(ReturnRequest) private readonly returns: Repository<ReturnRequest>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem) private readonly orderItems: Repository<OrderItem>,
  ) {}

  /**
   * What can still be sent back from an order, and why anything cannot.
   *
   * The app needs the negative cases as much as the positive ones — "the window
   * closed on 12 March" is a far better screen than a returns button that is
   * simply absent with no explanation.
   */
  async listEligibleItems(userId: string, orderId: string): Promise<EligibleItem[]> {
    const order = await this.requireDeliveredOrder(userId, orderId);
    const withinWindow = this.isWithinReturnWindow(order);

    const [items, existing] = await Promise.all([
      this.orderItems.find({ where: { orderId }, order: { createdAt: 'ASC' } }),
      this.returns.find({ where: { orderId } }),
    ]);

    const requestedItemIds = new Set(existing.map((r) => r.orderItemId));

    return items.map((item) => {
      const alreadyRequested = requestedItemIds.has(item.id);

      return {
        orderItemId: item.id,
        productName: item.productName,
        nominalSize: item.nominalSize,
        colour: item.colour,
        quantity: item.quantity,
        isEligible: withinWindow && !alreadyRequested,
        reasonIneligible: alreadyRequested
          ? 'A return has already been requested for this item'
          : withinWindow
            ? null
            : `The ${RETURN_WINDOW_DAYS}-day return window has closed`,
      };
    });
  }

  async requestReturn(
    userId: string,
    orderId: string,
    input: {
      orderItemId: string;
      quantity: number;
      reason: string;
      comment?: string | null;
      fitTag?: FitTag | null;
    },
  ): Promise<ReturnRequestView> {
    const order = await this.requireDeliveredOrder(userId, orderId);

    if (!this.isWithinReturnWindow(order)) {
      throw new ConflictException({
        code: 'RETURN_WINDOW_CLOSED',
        message: `Returns must be requested within ${RETURN_WINDOW_DAYS} days of delivery.`,
        deliveredAt: order.deliveredAt?.toISOString() ?? null,
      });
    }

    const item = await this.orderItems.findOne({
      where: { id: input.orderItemId, orderId },
    });

    if (!item) {
      throw new NotFoundException('That item is not part of this order');
    }

    if (input.quantity > item.quantity) {
      throw new BadRequestException({
        code: 'QUANTITY_EXCEEDS_ORDER',
        message: `You ordered ${item.quantity} of this item.`,
      });
    }

    try {
      const saved = await this.returns.save(
        this.returns.create({
          orderId,
          orderItemId: item.id,
          userId,
          quantity: input.quantity,
          reason: input.reason,
          comment: input.comment ?? null,
          // Only meaningful for sizing returns; this is the signal that feeds
          // back into correcting the product's size chart.
          fitTag: input.fitTag ?? null,
          status: ReturnStatus.REQUESTED,
        }),
      );

      this.logger.log(`Return requested for ${order.orderNumber} / ${item.sku}`);
      return this.toView(saved, order, item);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === PG_UNIQUE_VIOLATION
      ) {
        // `uq_return_request_order_item` — a double-tap, not a new request.
        throw new ConflictException({
          code: 'RETURN_ALREADY_REQUESTED',
          message: 'A return has already been requested for this item.',
        });
      }
      throw error;
    }
  }

  async listForUser(userId: string): Promise<ReturnRequestView[]> {
    const rows = await this.returns.find({
      where: { userId },
      relations: { order: true, orderItem: true },
      order: { createdAt: 'DESC' },
    });

    return rows.map((row) => this.toView(row, row.order, row.orderItem));
  }

  /** Admin review queue. */
  async listAll(status: ReturnStatus | undefined, limit: number, offset: number) {
    const rows = await this.returns.find({
      where: status ? { status } : {},
      relations: { order: true, orderItem: true },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return rows.map((row) => this.toView(row, row.order, row.orderItem));
  }

  /**
   * Admin decision on a request.
   *
   * No refund is issued here. Money movement on a return needs the Cashfree
   * refund API for prepaid orders and a manual path for COD, neither of which
   * exists yet — issuing wallet credit instead would quietly convert a cash
   * refund into store credit, which is a business decision, not an
   * implementation detail.
   */
  async review(
    id: string,
    status: ReturnStatus,
    adminNote?: string | null,
  ): Promise<ReturnRequestView> {
    const request = await this.returns.findOne({
      where: { id },
      relations: { order: true, orderItem: true },
    });

    if (!request) {
      throw new NotFoundException('Return request not found');
    }

    request.status = status;
    if (adminNote !== undefined) {
      request.adminNote = adminNote;
    }
    if (status === ReturnStatus.COMPLETED || status === ReturnStatus.REJECTED) {
      request.resolvedAt = new Date();
    }

    const saved = await this.returns.save(request);
    return this.toView(saved, request.order, request.orderItem);
  }

  // ---- internals ----

  private async requireDeliveredOrder(userId: string, orderId: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id: orderId, userId } });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status !== OrderStatus.DELIVERED) {
      throw new ConflictException({
        code: 'ORDER_NOT_DELIVERED',
        message: 'Only delivered orders can be returned.',
      });
    }

    return order;
  }

  private isWithinReturnWindow(order: Order): boolean {
    if (!order.deliveredAt) {
      // Belt and braces: the status check above already requires DELIVERED, and
      // the transition service stamps this timestamp. Without a delivery date
      // there is no window to be inside.
      return false;
    }

    const closesAt = order.deliveredAt.getTime() + RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    return Date.now() <= closesAt;
  }

  private toView(request: ReturnRequest, order: Order, item: OrderItem): ReturnRequestView {
    return {
      id: request.id,
      orderId: request.orderId,
      orderNumber: order?.orderNumber ?? '',
      orderItemId: request.orderItemId,
      productName: item?.productName ?? '',
      nominalSize: item?.nominalSize ?? 0,
      colour: item?.colour ?? '',
      quantity: request.quantity,
      reason: request.reason,
      comment: request.comment,
      fitTag: request.fitTag,
      status: request.status,
      adminNote: request.adminNote,
      createdAt: request.createdAt.toISOString(),
      resolvedAt: request.resolvedAt?.toISOString() ?? null,
    };
  }
}
