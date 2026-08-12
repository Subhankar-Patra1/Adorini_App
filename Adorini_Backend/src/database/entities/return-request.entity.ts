import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';

import { BaseEntity } from './base.entity';
import { FitTag, ReturnStatus } from '../../common/enums/domain.enums';
import type { Order } from './order.entity';
import type { OrderItem } from './order-item.entity';
import type { User } from './user.entity';

/**
 * A request to send an item back.
 *
 * Modelled against the **order line**, not the order: a buyer who ordered three
 * kurtis and wants to return one should not have the whole order marked as
 * returned. This is also why returns are not an `OrderStatus` — "was this ever
 * delivered?" must stay answerable from the order alone, which the state
 * machine's comment already relies on.
 *
 * `fitTag` is the reason this table earns its place beyond logistics. When the
 * reason is sizing, the tag feeds the same signal as a review's fit tag and
 * tells us which size chart is wrong — which is the loop the whole
 * returns-reduction bet depends on.
 */
@Unique('uq_return_request_order_item', ['orderItemId'])
@Index('idx_return_requests_status', ['status', 'createdAt'])
@Index('idx_return_requests_user', ['userId'])
@Check('chk_return_quantity_positive', '"quantity" > 0')
@Entity('return_requests')
export class ReturnRequest extends BaseEntity {
  @ManyToOne('Order', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  order: Order;

  @Column({ type: 'uuid' })
  orderId: string;

  /**
   * One open request per line — `uq_return_request_order_item` enforces it.
   * Without that, tapping "return" twice would create two requests for the same
   * garment and, once refunds exist, two refunds.
   */
  @ManyToOne('OrderItem', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  orderItem: OrderItem;

  @Column({ type: 'uuid' })
  orderItemId: string;

  /** Denormalised so the buyer's own return list needs no join through orders. */
  @ManyToOne('User', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'integer' })
  quantity: number;

  @Column({ type: 'varchar', length: 64 })
  reason: string;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  /**
   * Set when the reason is sizing. Feeds size-chart correction alongside review
   * fit tags — a return is the strongest possible signal that a chart is wrong.
   */
  @Column({ type: 'enum', enum: FitTag, enumName: 'fit_tag', nullable: true })
  fitTag: FitTag | null;

  @Column({
    type: 'enum',
    enum: ReturnStatus,
    enumName: 'return_status',
    default: ReturnStatus.REQUESTED,
  })
  status: ReturnStatus;

  @Column({ type: 'text', nullable: true })
  adminNote: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;
}
