import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WalletCreditService } from './services/wallet-credit.service';
import { Referral } from '../../database/entities/referral.entity';
import { Wallet } from '../../database/entities/wallet.entity';
import { WalletTransaction } from '../../database/entities/wallet-transaction.entity';

/**
 * Wallet domain core only, for the same reason as `OrdersModule`: the balance
 * and statement endpoints are per-user reads that need the auth module's
 * identity. What exists here is the crediting path, which is driven by a
 * delivery webhook rather than by a logged-in request.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Wallet, WalletTransaction, Referral])],
  providers: [WalletCreditService],
  exports: [WalletCreditService],
})
export class WalletModule {}
