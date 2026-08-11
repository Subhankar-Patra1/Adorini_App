import { maskPhone, normalisePhone, phoneSchema } from './phone.util';

describe('normalisePhone', () => {
  // The whole point of this function: every one of these is the same person,
  // and `users.phone` is UNIQUE. If they normalised differently they would
  // become separate accounts — separate carts, wallets, and referral claims.
  it.each([
    ['9876543210', 'bare 10-digit'],
    ['+919876543210', 'E.164 with plus'],
    ['919876543210', 'country code, no plus'],
    ['09876543210', 'trunk-prefixed'],
    ['+91 98765 43210', 'spaced'],
    ['098765-43210', 'dashed'],
    ['  9876543210  ', 'padded'],
  ])('normalises %s (%s) to 919876543210', (input) => {
    expect(normalisePhone(input)).toBe('919876543210');
  });

  it.each([
    ['1234567890', 'starts with 1 — not an Indian mobile'],
    ['5876543210', 'starts with 5 — landline range'],
    ['98765432', 'too short'],
    ['98765432101', 'too long'],
    ['', 'empty'],
    ['abcdefghij', 'not digits'],
    ['919876543', 'country code but truncated'],
    ['929876543210', 'wrong country code'],
  ])('rejects %s (%s)', (input) => {
    expect(normalisePhone(input)).toBeNull();
  });
});

describe('phoneSchema', () => {
  it('validates and normalises in one step', () => {
    // A DTO using this can never hand a service an un-normalised number.
    expect(phoneSchema.parse('+91 98765 43210')).toBe('919876543210');
  });

  it('rejects a correctly-sized but invalid number with a useful message', () => {
    // 10 digits, so it clears the length check and reaches the transform —
    // but Indian mobiles never start with 1.
    const result = phoneSchema.safeParse('1234567890');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/Indian mobile/i);
    }
  });

  it('rejects a too-short value on length before reaching the transform', () => {
    expect(phoneSchema.safeParse('12345').success).toBe(false);
  });
});

describe('maskPhone', () => {
  it('keeps only the last four digits', () => {
    expect(maskPhone('919876543210')).toBe('****3210');
  });

  it('reveals nothing for a very short value', () => {
    expect(maskPhone('12')).toBe('****');
  });
});
