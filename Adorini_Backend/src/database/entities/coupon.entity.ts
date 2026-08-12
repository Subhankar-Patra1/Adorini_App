import { Check, Column, Entity, Index } from 'typeorm';

import { BaseEntity } from './base.entity';
import { DiscountType } from '../../common/enums/domain.enums';

/**
 * A discount code, redeemable once per account (see `CouponRedemption`).
 *
 * Deliberately **not** the same feature as a gift card: this discounts an
 * order at checkout, it never holds a stored-value balance a buyer can spend
 * across multiple orders. Gift cards are a materially different, separately
 * risky feature (issuance, balance tracking, fraud on a redeemable balance)
 * and are out of scope here — see ADR-032.
 */
@Check('chk_coupon_discount_value_positive', '"discount_value" > 0')
@Check(
  'chk_coupon_percent_range',
  `"discount_type" <> 'PERCENT' OR "discount_value" <= 100`,
)
@Entity('coupons')
export class Coupon extends BaseEntity {
  /** Stored uppercase; compared case-insensitively is how buyers actually type it. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'enum', enum: DiscountType, enumName: 'discount_type' })
  discountType: DiscountType;

  /** A percent (1–100) or a flat amount in paise, depending on `discountType`. */
  @Column({ type: 'integer' })
  discountValue: number;

  /** Coupon does not apply below this subtotal. Null means no minimum. */
  @Column({ type: 'integer', nullable: true })
  minOrderPaise: number | null;

  /** Caps a PERCENT discount in absolute terms. Ignored for FLAT, harmless if set. */
  @Column({ type: 'integer', nullable: true })
  maxDiscountPaise: number | null;

  /** Global redemption cap across all buyers. Null means unlimited. */
  @Column({ type: 'integer', nullable: true })
  maxRedemptions: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  validFrom: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  validUntil: Date | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}
