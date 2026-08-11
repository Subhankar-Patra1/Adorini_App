import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { Order } from './order.entity';
import type { User } from './user.entity';
import { ReferralStatus } from '../../common/enums/domain.enums';

/**
 * A referral: one existing user brought in one new user, worth ₹100 in wallet
 * credit once the referee's first order is actually delivered.
 *
 * @GUARD Risk #6 (LOW): referral abuse. Two constraints make the cheapest
 * attacks impossible at the database level rather than relying on service code
 * that a later refactor could bypass:
 *
 *   1. `chk_referral_no_self_referral` — a user cannot refer themselves.
 *   2. `uq_referral_referee_phone` — a given phone number can only ever be
 *      referred once, so deleting an account and re-signing up with the same
 *      number does not mint a second ₹100.
 *
 * Both user FKs are `ON DELETE SET NULL`, not `CASCADE`, and that is load-
 * bearing rather than incidental: under `CASCADE`, deleting the referee's
 * account deletes this row too, taking the phone claim with it and reopening
 * the exact abuse the unique constraint is meant to close. The referral is an
 * anti-abuse and accounting record — it has to outlive the accounts it refers
 * to. (An integration test covers this; it failed against the `CASCADE`
 * version.)
 *
 * Retaining `referee_phone` past account deletion is a deliberate trade of
 * data minimisation for fraud prevention, and is flagged for the @ETHICS gate —
 * storing a salted hash instead would preserve the uniqueness property while
 * holding less personal data.
 *
 * Device/IP fingerprinting is explicitly out of scope for MVP (SPEC non-goals);
 * these constraints are the floor, not the ceiling.
 */
@Unique('uq_referral_referee_phone', ['refereePhone'])
@Check('chk_referral_no_self_referral', '"referrer_id" <> "referee_id"')
@Index('idx_referrals_referrer_status', ['referrerId', 'status'])
@Entity('referrals')
export class Referral extends BaseEntity {
  /** The existing user who shared their code. Null once that account is deleted. */
  @ManyToOne('User', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  referrer: User | null;

  @Column({ type: 'uuid', nullable: true })
  referrerId: string | null;

  /** The newly signed-up user. Null once that account is deleted. */
  @ManyToOne('User', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  referee: User | null;

  @Column({ type: 'uuid', nullable: true })
  refereeId: string | null;

  /**
   * The referee's phone, copied at signup. Enforcing uniqueness here rather
   * than on `referee_id` is deliberate: user rows can be deleted and recreated,
   * phone numbers are the identity that persists across that.
   */
  @Column({ type: 'varchar', length: 15 })
  refereePhone: string;

  @Column({
    type: 'enum',
    enum: ReferralStatus,
    enumName: 'referral_status',
    default: ReferralStatus.PENDING,
  })
  status: ReferralStatus;

  @Column({ type: 'integer' })
  creditPaise: number;

  /** The referee order whose delivery triggers payout. */
  @ManyToOne('Order', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  qualifyingOrder: Order | null;

  @Column({ type: 'uuid', nullable: true })
  qualifyingOrderId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  creditedAt: Date | null;
}
