/** Metadata key read by `JwtAuthGuard` to skip authentication. */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Redis key builders.
 *
 * Centralised so the key shape is visible in one place — an OTP key typo'd at
 * one call site silently creates a second, never-read key, and the symptom is
 * "the correct code is rejected", which is miserable to debug.
 */
export const redisKeys = {
  /** HMAC of the pending OTP for a phone. */
  otpCode: (phone: string): string => `otp:code:${phone}`,
  /** Failed verification attempts against the current code. */
  otpAttempts: (phone: string): string => `otp:attempts:${phone}`,
  /** Presence means the resend cooldown has not elapsed. */
  otpResendCooldown: (phone: string): string => `otp:resend:${phone}`,
  /** Rolling hourly send counter, to cap SMS spend per number. */
  otpHourlyCount: (phone: string): string => `otp:reqcount:${phone}`,
  /** Pending Google registration awaiting phone verification, keyed by token hash. */
  googleRegistration: (tokenHash: string): string => `reg:google:${tokenHash}`,
} as const;
