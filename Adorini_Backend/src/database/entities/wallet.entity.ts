import { Check, Column, Entity, JoinColumn, OneToMany, OneToOne } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { User } from './user.entity';
import type { WalletTransaction } from './wallet-transaction.entity';

/**
 * A user's store credit balance, holding referral rewards and refunds.
 *
 * `balancePaise` is a running total kept in step with `WalletTransaction` rows
 * inside the same transaction that writes them. It is denormalised on purpose:
 * checkout reads the balance on every cart view, and summing the ledger each
 * time gets slower for exactly the loyal users who have the most rows.
 *
 * The non-negative check is the backstop against a concurrent double-spend
 * turning into free money.
 */
@Check('chk_wallet_balance_non_negative', '"balance_paise" >= 0')
@Entity('wallets')
export class Wallet extends BaseEntity {
  @OneToOne('User', 'wallet', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  user: User;

  @Column({ type: 'uuid', unique: true })
  userId: string;

  @Column({ type: 'integer', default: 0 })
  balancePaise: number;

  @OneToMany('WalletTransaction', 'wallet')
  transactions: WalletTransaction[];
}
