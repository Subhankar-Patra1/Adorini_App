import { Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ListWalletQueryDto, WalletBalanceDto, WalletEntryDto } from '../dto/wallet.dto';
import { WalletService, type WalletBalance, type WalletEntry } from '../services/wallet.service';
import { ReferralStatus } from '../../../common/enums/domain.enums';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { NoStoreInterceptor } from '../../../common/interceptors/no-store.interceptor';
import { Referral } from '../../../database/entities/referral.entity';
import type { AuthUser } from '../../../common/types/auth-user';

@ApiTags('wallet')
@ApiBearerAuth()
@UseInterceptors(NoStoreInterceptor)
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    @InjectRepository(Referral) private readonly referrals: Repository<Referral>,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Store credit balance',
    description:
      'Also reports credit still pending — referrals recorded but not yet released, which only happens once the referred buyer’s first order is delivered.',
  })
  @ApiResponse({ status: 200, type: WalletBalanceDto })
  async getBalance(@CurrentUser() user: AuthUser): Promise<WalletBalance> {
    // Shown separately from the spendable balance so a referrer can see the
    // reward is coming without it appearing as money they can spend today.
    const pending = await this.referrals
      .createQueryBuilder('referral')
      .select('COALESCE(SUM(referral.credit_paise), 0)', 'total')
      .where('referral.referrer_id = :userId', { userId: user.id })
      .andWhere('referral.status = :status', { status: ReferralStatus.PENDING })
      .getRawOne<{ total: string }>();

    return this.wallet.getBalance(user.id, Number(pending?.total ?? 0));
  }

  @Get('transactions')
  @ApiOperation({
    summary: 'Statement, newest first',
    description:
      'Every entry carries the balance as it stood immediately after it, so a disputed balance can be walked back line by line.',
  })
  @ApiResponse({ status: 200, type: [WalletEntryDto] })
  listTransactions(
    @CurrentUser() user: AuthUser,
    @Query() query: ListWalletQueryDto,
  ): Promise<WalletEntry[]> {
    return this.wallet.listTransactions(user.id, query.limit, query.offset);
  }
}
