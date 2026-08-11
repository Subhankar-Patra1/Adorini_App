import { Column, Entity, Index, OneToMany, OneToOne } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { Address } from './address.entity';
import type { Order } from './order.entity';
import type { Review } from './review.entity';
import type { Wallet } from './wallet.entity';

/**
 * A buyer or admin. Phone is the primary identity — Adorini onboards via MSG91
 * OTP, and Google OAuth is a secondary convenience that attaches to an existing
 * phone-identified account.
 */
@Entity('users')
export class User extends BaseEntity {
  /**
   * E.164 without the `+` (e.g. `919876543210`), normalised at the boundary.
   * Storing raw user input would let `+91 98765 43210` and `9876543210` become
   * two accounts — and two shots at the one-referral-per-phone rule
   * (@GUARD Risk #6).
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 15 })
  phone: string;

  @Index({ unique: true, where: 'email IS NOT NULL' })
  @Column({ type: 'varchar', length: 320, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  fullName: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  gender: string | null;

  /** R2 object key, not a URL — the public base URL is environment-specific. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  profilePhotoKey: string | null;

  @Index({ unique: true, where: 'google_id IS NOT NULL' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  googleId: string | null;

  @Column({ type: 'boolean', default: false })
  isPhoneVerified: boolean;

  @Column({ type: 'boolean', default: false })
  isAdmin: boolean;

  /**
   * The code this user shares to refer others. Nullable because it is minted
   * lazily on first share rather than for every account that ever signs up.
   */
  @Index({ unique: true, where: 'referral_code IS NOT NULL' })
  @Column({ type: 'varchar', length: 16, nullable: true })
  referralCode: string | null;

  @OneToMany('Address', 'user')
  addresses: Address[];

  @OneToMany('Order', 'user')
  orders: Order[];

  @OneToMany('Review', 'user')
  reviews: Review[];

  @OneToOne('Wallet', 'user')
  wallet: Wallet;
}
