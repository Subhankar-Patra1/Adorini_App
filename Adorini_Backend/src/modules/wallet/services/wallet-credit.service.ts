import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { ReferralStatus, WalletTransactionType } from '../../../common/enums/domain.enums';
import { Referral } from '../../../database/entities/referral.entity';
import { Wallet } from '../../../database/entities/wallet.entity';
import { WalletTransaction } from '../../../database/entities/wallet-transaction.entity';

export type ReferralCreditOutcome =
  | { outcome: 'credited'; referralId: string; creditPaise: number }
  | { outcome: 'voided'; referralId: string }
  | { outcome: 'no_referral' }
  | { outcome: 'already_settled'; referralId: string };

@Injectable()
export class WalletCreditService {
  private readonly logger = new Logger(WalletCreditService.name);

  /**
   * Pays the ₹100 referral reward for an order that has just been delivered.
   *
   * @GUARD Risk #1 (CRITICAL): runs on the caller's `EntityManager`, so the
   * credit, the ledger row, the referral status change and the
   * `processed_webhooks` insert all commit as one unit. A redelivered
   * `Delivered` event therefore cannot pay twice — the webhook insert conflicts
   * and this entire block rolls back.
   *
   * The `status = PENDING` filter plus the row lock is the second line of
   * defence: even if the same delivery were somehow applied through a different
   * path, the referral would already read `CREDITED` and this would decline.
   *
   * Crediting waits for delivery rather than firing at placement because a COD
   * order refused at the door would otherwise have already paid out.
   */
  async creditReferralForDeliveredOrder(
    manager: EntityManager,
    orderId: string,
  ): Promise<ReferralCreditOutcome> {
    const referral = await manager.findOne(Referral, {
      where: { qualifyingOrderId: orderId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!referral) {
      return { outcome: 'no_referral' };
    }

    if (referral.status !== ReferralStatus.PENDING) {
      this.logger.log(
        `Referral ${referral.id} already ${referral.status}; skipping duplicate payout`,
      );
      return { outcome: 'already_settled', referralId: referral.id };
    }

    /**
     * The referrer's account is gone (`ON DELETE SET NULL`, per ADR-008 — the
     * referral row outlives the accounts it names so the phone claim survives).
     * There is no wallet to credit, so void it rather than leaving it PENDING
     * forever where a later sweep might try again.
     */
    if (!referral.referrerId) {
      referral.status = ReferralStatus.VOID;
      await manager.save(Referral, referral);
      this.logger.warn(`Referral ${referral.id} voided — referrer account no longer exists`);
      return { outcome: 'voided', referralId: referral.id };
    }

    const wallet = await this.lockOrCreateWallet(manager, referral.referrerId);

    // Denormalised running balance, kept in step with the ledger inside this
    // same transaction — see the Wallet entity for why it is not a live SUM.
    wallet.balancePaise += referral.creditPaise;
    await manager.save(Wallet, wallet);

    await manager.save(
      WalletTransaction,
      manager.create(WalletTransaction, {
        walletId: wallet.id,
        type: WalletTransactionType.REFERRAL_CREDIT,
        amountPaise: referral.creditPaise,
        balanceAfterPaise: wallet.balancePaise,
        referenceId: referral.id,
        description: 'Referral reward — referee order delivered',
      }),
    );

    referral.status = ReferralStatus.CREDITED;
    referral.creditedAt = new Date();
    await manager.save(Referral, referral);

    this.logger.log(
      `Credited ${referral.creditPaise} paise to wallet ${wallet.id} for referral ${referral.id}`,
    );

    return { outcome: 'credited', referralId: referral.id, creditPaise: referral.creditPaise };
  }

  /**
   * Wallets are minted lazily — a user who never earns credit never needs a row.
   * Locked on read so two concurrent credits to the same wallet serialise instead
   * of both reading the pre-credit balance and one overwriting the other.
   */
  private async lockOrCreateWallet(manager: EntityManager, userId: string): Promise<Wallet> {
    const existing = await manager.findOne(Wallet, {
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });

    if (existing) {
      return existing;
    }

    return manager.save(Wallet, manager.create(Wallet, { userId, balancePaise: 0 }));
  }
}
