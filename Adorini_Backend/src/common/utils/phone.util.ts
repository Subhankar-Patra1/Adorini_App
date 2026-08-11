import { z } from 'zod';

/** Adorini sells only in India; every number normalises to the 91 country code. */
const INDIA_COUNTRY_CODE = '91';

/** Indian mobile numbers are 10 digits and never start with 0–5. */
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/**
 * Normalises a phone number to E.164 without the leading `+` — the exact form
 * stored in `users.phone` and sent to MSG91 (e.g. `919876543210`).
 *
 * This must be applied at every boundary where a phone enters the system.
 * `users.phone` is UNIQUE, so if `+91 98765 43210`, `09876543210` and
 * `9876543210` reached the database unnormalised they would become three
 * separate accounts for one person — three carts, three wallets, and three
 * shots at the one-referral-per-phone rule (@GUARD Risk #6).
 *
 * Returns `null` rather than throwing: callers decide whether a bad number is a
 * 400 or a silently ignored value.
 */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');

  // Already country-coded: 91 + 10 digits.
  if (digits.length === 12 && digits.startsWith(INDIA_COUNTRY_CODE)) {
    const national = digits.slice(2);
    return INDIAN_MOBILE.test(national) ? digits : null;
  }

  // Trunk-prefixed local form, as printed on most Indian paperwork: 0XXXXXXXXXX.
  if (digits.length === 11 && digits.startsWith('0')) {
    const national = digits.slice(1);
    return INDIAN_MOBILE.test(national) ? `${INDIA_COUNTRY_CODE}${national}` : null;
  }

  // Bare 10-digit national number — what buyers actually type.
  if (digits.length === 10) {
    return INDIAN_MOBILE.test(digits) ? `${INDIA_COUNTRY_CODE}${digits}` : null;
  }

  return null;
}

/**
 * Zod schema for any phone arriving over HTTP. Validates and normalises in one
 * step, so a DTO can never hand a service an un-normalised number.
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(10)
  .max(20)
  .transform((value, ctx) => {
    const normalised = normalisePhone(value);

    if (!normalised) {
      ctx.addIssue({
        code: 'custom',
        message: 'Must be a valid Indian mobile number',
      });
      return z.NEVER;
    }

    return normalised;
  });

/**
 * Masks a phone for logs. Phone numbers are personal data and end up in log
 * aggregators that outlive the account.
 */
export function maskPhone(phone: string): string {
  return phone.length <= 4 ? '****' : `****${phone.slice(-4)}`;
}
