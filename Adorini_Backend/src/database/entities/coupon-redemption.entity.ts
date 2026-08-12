import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { Coupon } from './coupon.entity';
import type { Order } from './order.entity';
import type { User } from './user.entity';

/**
 * Records one redemption of one coupon by one account.
 *
 * `uq_coupon_redemption_coupon_user` fixes the per-user limit at exactly one —
 * simpler than a configurable per-user cap, and the only case the MVP needs.
 * It is also the backstop against two concurrent checkouts by the same buyer
 * both redeeming the same code: the global `maxRedemptions` cap is enforced by
 * locking the `Coupon` row during `CouponsService.redeem`, but this constraint
 * closes the per-user race independently of that lock ever being taken correctly.
 */
@Unique('uq_coupon_redemption_coupon_user', ['couponId', 'userId'])
@Index('idx_coupon_redemptions_coupon', ['couponId'])
@Entity('coupon_redemptions')
export class CouponRedemption extends BaseEntity {
  @ManyToOne('Coupon', { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn()
  coupon: Coupon;

  @Column({ type: 'uuid' })
  couponId: string;

  @ManyToOne('User', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  /** The order the discount actually landed on — created only once the order exists. */
  @ManyToOne('Order', { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn()
  order: Order;

  @Column({ type: 'uuid' })
  orderId: string;

  /** What the coupon was actually worth on this order, in paise — the audit trail. */
  @Column({ type: 'integer' })
  discountAppliedPaise: number;
}
