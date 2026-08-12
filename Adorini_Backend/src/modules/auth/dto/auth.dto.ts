import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { phoneSchema } from '../../../common/utils/phone.util';
import { ReferralOutcome } from '../referral-status';

/**
 * Request DTOs. Zod is the single validation system (ADR-007) — never
 * class-validator decorators.
 *
 * `phoneSchema` both validates and normalises, so a service can never be handed
 * an un-normalised number.
 */

export const requestOtpSchema = z.object({
  phone: phoneSchema,
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  /** Exactly six digits — anything else cannot be a code we issued. */
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, { error: 'OTP must be 6 digits' }),
  /** Present only when finishing a registration that began with Google. */
  registrationToken: z.string().min(1).max(256).optional(),
  referralCode: z.string().trim().min(1).max(16).optional(),
});

export const googleSignInSchema = z.object({
  // Google ID tokens are long; the ceiling exists only to stop an unbounded body.
  idToken: z.string().min(1).max(4096),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(256),
});

export class RequestOtpDto extends createZodDto(requestOtpSchema) {}
export class VerifyOtpDto extends createZodDto(verifyOtpSchema) {}
export class GoogleSignInDto extends createZodDto(googleSignInSchema) {}
export class RefreshTokenDto extends createZodDto(refreshSchema) {}
export class LogoutDto extends createZodDto(refreshSchema) {}

/**
 * Response schemas.
 *
 * Declared as Zod too, so the OpenAPI document the Flutter client is generated
 * from describes real response shapes rather than `any` (ADR-005).
 */

export const publicUserSchema = z.object({
  id: z.uuid(),
  phone: z.string(),
  email: z.string().nullable(),
  fullName: z.string().nullable(),
  gender: z.string().nullable(),
  profilePhotoKey: z.string().nullable(),
  isPhoneVerified: z.boolean(),
  hasGoogleLinked: z.boolean(),
});

export const otpRequestedSchema = z.object({
  expiresInSeconds: z.number().int(),
  resendAfterSeconds: z.number().int(),
});

export const loginResultSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
  isNewUser: z.boolean(),
  /** True only when `referralStatus` is `APPLIED`. */
  referralApplied: z.boolean(),
  /**
   * Why the referral was or was not recorded, so the client can show an
   * accurate message. `ALREADY_REFERRED` and `CODE_NOT_FOUND` in particular
   * call for opposite advice — stop retrying, versus check the spelling.
   */
  referralStatus: z.enum(ReferralOutcome),
  user: publicUserSchema,
});

export const refreshedTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
});

/**
 * Google sign-in answers with one of two shapes, discriminated by `status`.
 *
 * `PHONE_REQUIRED` is a 200, not an error: Google verified the identity, but
 * `users.phone` is NOT NULL so the account cannot exist until a phone is
 * verified. A discriminated union is far easier for a typed client to branch on
 * than catching an exception.
 */
export const googleAuthenticatedSchema = loginResultSchema.extend({
  status: z.literal('AUTHENTICATED'),
});

export const googlePhoneRequiredSchema = z.object({
  status: z.literal('PHONE_REQUIRED'),
  registrationToken: z.string(),
  expiresInSeconds: z.number().int(),
});

/**
 * The two branches are declared as separate DTOs rather than one union DTO:
 * `createZodDto` builds a class from an object schema and cannot represent a
 * union. The controller advertises them to Swagger as a `oneOf`, which is what
 * a generated client needs to branch on `status` anyway.
 */
export class PublicUserResponseDto extends createZodDto(publicUserSchema) {}
export class OtpRequestedResponseDto extends createZodDto(otpRequestedSchema) {}
export class LoginResultResponseDto extends createZodDto(loginResultSchema) {}
export class RefreshedTokensResponseDto extends createZodDto(refreshedTokensSchema) {}
export class GoogleAuthenticatedResponseDto extends createZodDto(googleAuthenticatedSchema) {}
export class GooglePhoneRequiredResponseDto extends createZodDto(googlePhoneRequiredSchema) {}
