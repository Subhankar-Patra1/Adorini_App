import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from './base.entity';
import type { Wallet } from './wallet.entity';
import { WalletTransactionType } from '../../common/enums/domain.enums';

/**
 * An append-only ledger entry against a wallet. Never updated, never deleted —
 * a disputed balance is answered by replaying these rows.
 *
 * `amountPaise` is signed: credits positive, debits negative. A single signed
 * column means the balance is `SUM(amount_paise)` with no CASE expression, and
 * removes the class of bug where a debit is recorded with a positive amount.
 */
@Index('idx_wallet_txn_wallet_created', ['walletId', 'createdAt'])
@Check('chk_wallet_txn_amount_non_zero', '"amount_paise" <> 0')
@Check(
  'chk_wallet_txn_sign_matches_type',
  `("type" IN ('REFERRAL_CREDIT', 'REFUND_CREDIT') AND "amount_paise" > 0)
   OR ("type" = 'ORDER_DEBIT' AND "amount_paise" < 0)
   OR "type" = 'ADMIN_ADJUSTMENT'`,
)
@Entity('wallet_transactions')
export class WalletTransaction extends BaseEntity {
  @ManyToOne('Wallet', 'transactions', {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn()
  wallet: Wallet;

  @Column({ type: 'uuid' })
  walletId: string;

  @Column({
    type: 'enum',
    enum: WalletTransactionType,
    enumName: 'wallet_transaction_type',
  })
  type: WalletTransactionType;

  /** Signed: positive credits, negative debits. */
  @Column({ type: 'integer' })
  amountPaise: number;

  /** Balance after this entry, so a statement needs no running sum. */
  @Column({ type: 'integer' })
  balanceAfterPaise: number;

  /** The order or referral that caused this entry. */
  @Column({ type: 'uuid', nullable: true })
  referenceId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;
}
