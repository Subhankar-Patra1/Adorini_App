import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { FitTag, ReturnStatus } from '../../../common/enums/domain.enums';

/**
 * Reasons offered as a closed list rather than free text.
 *
 * The sizing ones are the point: paired with `fitTag` they say *which way* the
 * garment was wrong, which is what corrects the size chart. Free text alone
 * would bury that signal in prose nobody aggregates.
 */
export const RETURN_REASONS = [
  'SIZE_TOO_SMALL',
  'SIZE_TOO_LARGE',
  'QUALITY_NOT_AS_EXPECTED',
  'WRONG_ITEM_RECEIVED',
  'DAMAGED_ON_ARRIVAL',
  'COLOUR_DIFFERENT',
  'CHANGED_MY_MIND',
  'OTHER',
] as const;

export const createReturnSchema = z
  .object({
    orderItemId: z.uuid(),
    quantity: z.number().int().min(1).max(20),
    reason: z.enum(RETURN_REASONS),
    comment: z.string().trim().max(1000).nullable().optional(),
    fitTag: z.enum(FitTag).nullable().optional(),
  })
  .transform((body) => ({
    ...body,
    // Derived rather than trusted: a sizing reason implies its fit tag, so the
    // two can never contradict each other in the data the size chart learns from.
    fitTag:
      body.reason === 'SIZE_TOO_SMALL'
        ? FitTag.RUNS_SMALL
        : body.reason === 'SIZE_TOO_LARGE'
          ? FitTag.RUNS_LARGE
          : (body.fitTag ?? null),
  }));

export const reviewReturnSchema = z.object({
  status: z.enum(ReturnStatus),
  adminNote: z.string().trim().max(2000).nullable().optional(),
});

export const listReturnsQuerySchema = z.object({
  status: z.enum(ReturnStatus).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

export class CreateReturnDto extends createZodDto(createReturnSchema) {}
export class ReviewReturnDto extends createZodDto(reviewReturnSchema) {}
export class ListReturnsQueryDto extends createZodDto(listReturnsQuerySchema) {}

// ---- responses ----

export const returnRequestSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  orderNumber: z.string(),
  orderItemId: z.uuid(),
  productName: z.string(),
  nominalSize: z.number().int(),
  colour: z.string(),
  quantity: z.number().int(),
  reason: z.string(),
  comment: z.string().nullable(),
  fitTag: z.enum(FitTag).nullable(),
  status: z.enum(ReturnStatus),
  adminNote: z.string().nullable(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});

export const eligibleItemSchema = z.object({
  orderItemId: z.uuid(),
  productName: z.string(),
  nominalSize: z.number().int(),
  colour: z.string(),
  quantity: z.number().int(),
  isEligible: z.boolean(),
  /** Why not, so the app can explain rather than just hide the button. */
  reasonIneligible: z.string().nullable(),
});

export class ReturnRequestDto extends createZodDto(returnRequestSchema) {}
export class EligibleItemDto extends createZodDto(eligibleItemSchema) {}
