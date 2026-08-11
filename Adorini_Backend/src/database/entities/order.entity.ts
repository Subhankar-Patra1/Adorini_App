import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { OrderItem } from './order-item.entity';
import type { User } from './user.entity';
import { OrderStatus, PaymentMethod, PaymentStatus } from '../../common/enums/domain.enums';

/**
 * The delivery address as it stood when the order was placed.
 *
 * Snapshotted rather than referenced: a buyer editing their saved address must
 * not retroactively change where a delivered order went. It stays editable on
 * the order itself until status reaches `SHIPPED` (@GUARD Risk #2).
 */
export interface ShippingAddressSnapshot {
  recipientName: string;
  recipientPhone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
}

/**
 * A placed order.
 *
 * Every monetary column is server-computed at placement from the catalog and
 * the configured business rules; nothing the client sends about price is
 * trusted (@GUARD Risk #3). The totals check constraint below is the last line
 * of that defence — it makes an internally inconsistent order unstorable.
 */
@Index('idx_orders_user_created', ['userId', 'createdAt'])
@Index('idx_orders_status', ['status'])
@Check(
  'chk_order_totals_consistent',
  '"total_paise" = "subtotal_paise" - "discount_paise" + "delivery_fee_paise" - "wallet_credit_paise"',
)
@Check(
  'chk_order_amounts_non_negative',
  `"subtotal_paise" >= 0 AND "discount_paise" >= 0 AND "delivery_fee_paise" >= 0 AND "wallet_credit_paise" >= 0 AND "total_paise" >= 0`,
)
@Entity('orders')
export class Order extends BaseEntity {
  /**
   * Human-readable reference quoted in support calls and SMS (e.g.
   * `ADR-2026-0001234`). Distinct from the UUID primary key, which is correct
   * for joins but unusable over a phone call.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  orderNumber: string;

  @ManyToOne('User', 'orders', { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn()
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    enumName: 'order_status',
    default: OrderStatus.ORDERED,
  })
  status: OrderStatus;

  @Column({ type: 'enum', enum: PaymentMethod, enumName: 'payment_method' })
  paymentMethod: PaymentMethod;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    enumName: 'payment_status',
    default: PaymentStatus.PENDING,
  })
  paymentStatus: PaymentStatus;

  @Column({ type: 'jsonb' })
  shippingAddress: ShippingAddressSnapshot;

  /** Sum of line totals before any discount or delivery fee. */
  @Column({ type: 'integer' })
  subtotalPaise: number;

  /** First-order and coupon discounts, recomputed server-side. */
  @Column({ type: 'integer', default: 0 })
  discountPaise: number;

  /** Zero above `FREE_DELIVERY_THRESHOLD_PAISE`, recomputed server-side. */
  @Column({ type: 'integer', default: 0 })
  deliveryFeePaise: number;

  /** Wallet balance applied at checkout. */
  @Column({ type: 'integer', default: 0 })
  walletCreditPaise: number;

  @Column({ type: 'integer' })
  totalPaise: number;

  /** Cashfree's order handle, for reconciliation against their webhook. */
  @Index({ unique: true, where: 'cashfree_order_id IS NOT NULL' })
  @Column({ type: 'varchar', length: 128, nullable: true })
  cashfreeOrderId: string | null;

  /** Delhivery waybill number, once a shipment is registered. */
  @Index({ unique: true, where: 'delhivery_waybill IS NOT NULL' })
  @Column({ type: 'varchar', length: 64, nullable: true })
  delhiveryWaybill: string | null;

  /**
   * When the COD intent OTP was confirmed. A COD order must not leave
   * `PENDING_VERIFICATION` while this is null.
   */
  @Column({ type: 'timestamptz', nullable: true })
  codVerifiedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  shippedAt: Date | null;

  /** Set on the `DELIVERED` transition — the trigger for referral payout. */
  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cancellationReason: string | null;

  @OneToMany('OrderItem', 'order')
  items: OrderItem[];
}
