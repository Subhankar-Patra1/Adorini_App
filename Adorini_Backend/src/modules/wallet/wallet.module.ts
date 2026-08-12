import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WalletController } from './controllers/wallet.controller';
import { WalletCreditService } from './services/wallet-credit.service';
import { WalletService } from './services/wallet.service';
import { Referral } from '../../database/entities/referral.entity';
import { Wallet } from '../../database/entities/wallet.entity';
import { WalletTransaction } from '../../database/entities/wallet-transaction.entity';

/**
 * Two distinct paths, deliberately separated.
 *
 * `WalletCreditService` is the **write** path — the referral payout, driven by
 * a delivery webhook and always running inside the caller's transaction so it
 * commits with the `processed_webhooks` marker (@GUARD Risk #1). It never
 * belongs to a logged-in request.
 *
 * `WalletService` is the **read** path — balance and statement for the buyer
 * looking at their own account. Keeping them apart means a read can never
 * accidentally acquire the write path's row locks.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Wallet, WalletTransaction, Referral])],
  controllers: [WalletController],
  providers: [WalletCreditService, WalletService],
  exports: [WalletCreditService, WalletService],
})
export class WalletModule {}
