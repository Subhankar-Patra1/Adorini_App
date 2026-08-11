import { validateEnv } from './env.validation';

/**
 * A valid baseline. Individual tests mutate one field to prove that field is
 * actually enforced — if a rule is deleted from the schema, its test fails.
 */
const validEnv: Record<string, string> = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/adorini',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(32),
  GOOGLE_OAUTH_CLIENT_ID: 'client-id',
  MSG91_AUTH_KEY: 'key',
  MSG91_OTP_TEMPLATE_ID: 'template',
  MSG91_SENDER_ID: 'sender',
  CASHFREE_APP_ID: 'app',
  CASHFREE_SECRET_KEY: 'secret',
  CASHFREE_WEBHOOK_SECRET: 'webhook-secret',
  DELHIVERY_API_TOKEN: 'token',
  R2_ACCOUNT_ID: 'account',
  R2_ACCESS_KEY_ID: 'access-key',
  R2_SECRET_ACCESS_KEY: 'secret-key',
  R2_BUCKET_NAME: 'adorini-media',
  R2_PUBLIC_BASE_URL: 'https://media.example.com',
};

describe('validateEnv', () => {
  it('accepts a complete valid environment', () => {
    expect(() => validateEnv(validEnv)).not.toThrow();
  });

  it('applies documented defaults when optional values are omitted', () => {
    const env = validateEnv(validEnv);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.API_PREFIX).toBe('api');
    expect(env.CASHFREE_ENV).toBe('SANDBOX');
    // Business rules default to the PRD's stated values, in paise.
    expect(env.FREE_DELIVERY_THRESHOLD_PAISE).toBe(300_000); // ₹3,000
    expect(env.REFERRAL_CREDIT_PAISE).toBe(10_000); // ₹100
    expect(env.FIRST_ORDER_DISCOUNT_PERCENT).toBe(10);
    // Mobile OAuth client IDs default to an empty array when omitted.
    expect(env.GOOGLE_OAUTH_MOBILE_CLIENT_IDS).toEqual([]);
  });

  it('parses GOOGLE_OAUTH_MOBILE_CLIENT_IDS into a trimmed array', () => {
    const env = validateEnv({
      ...validEnv,
      GOOGLE_OAUTH_MOBILE_CLIENT_IDS: 'android-id , ios-id ,  web2-id',
    });

    expect(env.GOOGLE_OAUTH_MOBILE_CLIENT_IDS).toEqual(['android-id', 'ios-id', 'web2-id']);
  });

  it('rejects a JWT_SECRET shorter than 32 characters', () => {
    expect(() => validateEnv({ ...validEnv, JWT_SECRET: 'too-short' })).toThrow(
      /JWT_SECRET must be at least 32 characters/,
    );
  });

  it('rejects a malformed DATABASE_URL', () => {
    expect(() => validateEnv({ ...validEnv, DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });

  it.each([
    'DATABASE_URL',
    'REDIS_URL',
    'JWT_SECRET',
    'MSG91_AUTH_KEY',
    'CASHFREE_SECRET_KEY',
    'CASHFREE_WEBHOOK_SECRET',
    'DELHIVERY_API_TOKEN',
    'R2_SECRET_ACCESS_KEY',
  ])('refuses to boot when required secret %s is missing', (key) => {
    const incomplete = { ...validEnv };
    delete incomplete[key];

    expect(() => validateEnv(incomplete)).toThrow(new RegExp(key));
  });

  it('reports every invalid field at once, not just the first', () => {
    expect(() => validateEnv({ ...validEnv, JWT_SECRET: 'short', DATABASE_URL: 'nope' })).toThrow(
      /JWT_SECRET[\s\S]*DATABASE_URL|DATABASE_URL[\s\S]*JWT_SECRET/,
    );
  });

  it('rejects an out-of-range discount percentage', () => {
    expect(() => validateEnv({ ...validEnv, FIRST_ORDER_DISCOUNT_PERCENT: '150' })).toThrow(
      /FIRST_ORDER_DISCOUNT_PERCENT/,
    );
  });

  it('coerces numeric strings to numbers', () => {
    const env = validateEnv({ ...validEnv, PORT: '8080' });

    expect(env.PORT).toBe(8080);
    expect(typeof env.PORT).toBe('number');
  });

  it('transforms DATABASE_SSL into a boolean', () => {
    expect(validateEnv({ ...validEnv, DATABASE_SSL: 'true' }).DATABASE_SSL).toBe(true);
    expect(validateEnv({ ...validEnv, DATABASE_SSL: 'false' }).DATABASE_SSL).toBe(false);
  });
});
