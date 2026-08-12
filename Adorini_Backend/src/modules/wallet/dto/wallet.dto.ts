import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { WalletTransactionType } from '../../../common/enums/domain.enums';

export const listWalletQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

export class ListWalletQueryDto extends createZodDto(listWalletQuerySchema) {}

// ---- responses ----

export const walletBalanceSchema = z.object({
  balancePaise: z.number().int(),
  /** Referral rewards recorded but not yet released — not spendable. */
  pendingReferralCreditPaise: z.number().int(),
});

export const walletEntrySchema = z.object({
  id: z.uuid(),
  type: z.enum(WalletTransactionType),
  /** Signed: credits positive, debits negative. */
  amountPaise: z.number().int(),
  balanceAfterPaise: z.number().int(),
  description: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export class WalletBalanceDto extends createZodDto(walletBalanceSchema) {}
export class WalletEntryDto extends createZodDto(walletEntrySchema) {}
