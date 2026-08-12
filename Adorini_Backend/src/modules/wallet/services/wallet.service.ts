import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WalletTransactionType } from '../../../common/enums/domain.enums';
import { Wallet } from '../../../database/entities/wallet.entity';
import { WalletTransaction } from '../../../database/entities/wallet-transaction.entity';

export interface WalletBalance {
  balancePaise: number;
  /** Credit earned but not yet released — referrals awaiting delivery. */
  pendingReferralCreditPaise: number;
}

export interface WalletEntry {
  id: string;
  type: WalletTransactionType;
  /** Signed: credits positive, debits negative. */
  amountPaise: number;
  balanceAfterPaise: number;
  description: string | null;
  createdAt: string;
}

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(WalletTransaction)
    private readonly transactions: Repository<WalletTransaction>,
  ) {}

  /**
   * The buyer's balance.
   *
   * Reports zero rather than 404 when no wallet row exists. Signup creates one
   * for every account, so this is only reachable for accounts predating that —
   * and "you have no wallet" is not a distinction a buyer should ever be shown.
   */
  async getBalance(userId: string, pendingReferralCreditPaise = 0): Promise<WalletBalance> {
    const wallet = await this.wallets.findOne({ where: { userId } });

    return {
      balancePaise: wallet?.balancePaise ?? 0,
      pendingReferralCreditPaise,
    };
  }

  /**
   * The statement, newest first.
   *
   * Read from the append-only ledger rather than recomputed, and every row
   * carries the balance as it stood after it — so a disputed balance can be
   * walked back entry by entry without re-deriving anything.
   */
  async listTransactions(userId: string, limit = 50, offset = 0): Promise<WalletEntry[]> {
    const wallet = await this.wallets.findOne({ where: { userId } });

    if (!wallet) {
      return [];
    }

    const rows = await this.transactions.find({
      where: { walletId: wallet.id },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      amountPaise: row.amountPaise,
      balanceAfterPaise: row.balanceAfterPaise,
      description: row.description,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
