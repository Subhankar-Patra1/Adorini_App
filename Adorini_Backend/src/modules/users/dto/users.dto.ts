import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { phoneSchema } from '../../../common/utils/phone.util';
import { ReferralStatus } from '../../../common/enums/domain.enums';

/** Matches the `chk_address_pincode_format` check constraint on `addresses`. */
const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, { error: 'Must be a valid 6-digit Indian PIN code' });

/**
 * Profile update.
 *
 * `phone` is absent by design — it identifies the account and changing it is an
 * OTP-verified flow, not a profile edit. Nullable fields accept `null` so a
 * buyer can clear something they previously set.
 */
export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).nullable(),
    email: z.email().max(320).nullable(),
    gender: z.string().trim().max(32).nullable(),
    profilePhotoKey: z.string().trim().max(512).nullable(),
  })
  .partial();

export const addressBodySchema = z.object({
  recipientName: z.string().trim().min(1).max(120),
  recipientPhone: phoneSchema,
  line1: z.string().trim().min(1).max(255),
  line2: z.string().trim().max(255).nullable().optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  pincode: pincodeSchema,
  isDefault: z.boolean().optional(),
});

export const updateAddressSchema = addressBodySchema.partial();

export class UpdateProfileDto extends createZodDto(updateProfileSchema) {}
export class CreateAddressDto extends createZodDto(addressBodySchema) {}
export class UpdateAddressDto extends createZodDto(updateAddressSchema) {}

// ---- responses ----

/**
 * Timestamps are documented as ISO-8601 strings, not `z.date()`.
 *
 * The values are `Date` objects in memory, but they cross the wire as JSON and
 * serialise to strings — and a JS `Date` has no JSON Schema representation, so
 * `z.date()` makes OpenAPI generation throw at bootstrap. This describes what
 * the client actually receives.
 */
const isoTimestamp = z.iso.datetime();

export const addressResponseSchema = z.object({
  id: z.uuid(),
  recipientName: z.string(),
  recipientPhone: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  pincode: z.string(),
  isDefault: z.boolean(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const referralCodeResponseSchema = z.object({
  referralCode: z.string(),
});

export const referralSummarySchema = z.object({
  id: z.uuid(),
  status: z.enum(ReferralStatus),
  creditPaise: z.number().int(),
  createdAt: isoTimestamp,
  creditedAt: isoTimestamp.nullable(),
});

export class AddressResponseDto extends createZodDto(addressResponseSchema) {}
export class ReferralCodeResponseDto extends createZodDto(referralCodeResponseSchema) {}
export class ReferralSummaryResponseDto extends createZodDto(referralSummarySchema) {}
