import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { DiscountType } from '../../../common/enums/domain.enums';

const isoTimestamp = z.iso.datetime();

/** Stored and compared uppercase — the whole point is that a buyer can type it from memory. */
const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3)
  .max(32)
  .regex(/^[A-Z0-9]+$/, { error: 'Coupon codes may only contain letters and digits' });

export const createCouponSchema = z
  .object({
    code: couponCodeSchema,
    discountType: z.enum(DiscountType),
    discountValue: z.number().int().positive(),
    minOrderPaise: z.number().int().positive().nullable().optional(),
    maxDiscountPaise: z.number().int().positive().nullable().optional(),
    maxRedemptions: z.number().int().positive().nullable().optional(),
    validFrom: isoTimestamp.nullable().optional(),
    validUntil: isoTimestamp.nullable().optional(),
    isActive: z.boolean().optional().default(true),
  })
  .refine((body) => body.discountType !== DiscountType.PERCENT || body.discountValue <= 100, {
    error: 'A percent discount cannot exceed 100',
    path: ['discountValue'],
  });

export class CreateCouponDto extends createZodDto(createCouponSchema) {}

export const updateCouponSchema = z.object({
  minOrderPaise: z.number().int().positive().nullable().optional(),
  maxDiscountPaise: z.number().int().positive().nullable().optional(),
  maxRedemptions: z.number().int().positive().nullable().optional(),
  validFrom: isoTimestamp.nullable().optional(),
  validUntil: isoTimestamp.nullable().optional(),
  isActive: z.boolean().optional(),
});

export class UpdateCouponDto extends createZodDto(updateCouponSchema) {}

export const adminCouponSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  discountType: z.enum(DiscountType),
  discountValue: z.number().int(),
  minOrderPaise: z.number().int().nullable(),
  maxDiscountPaise: z.number().int().nullable(),
  maxRedemptions: z.number().int().nullable(),
  redemptionCount: z.number().int(),
  validFrom: isoTimestamp.nullable(),
  validUntil: isoTimestamp.nullable(),
  isActive: z.boolean(),
  createdAt: isoTimestamp,
});

export class AdminCouponDto extends createZodDto(adminCouponSchema) {}
