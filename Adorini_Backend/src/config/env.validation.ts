import { z } from 'zod';

/**
 * Environment schema. The app must refuse to boot on invalid config rather than
 * failing later at the first integration call — a missing Cashfree secret should
 * surface at startup, not at a customer's checkout.
 */
export const envSchema = z.object({
  // ---- Core ----
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default('api'),

  // ---- Database (PostgreSQL 18.4 on Railway) ----
  DATABASE_URL: z.url({ error: 'DATABASE_URL must be a valid connection URL' }),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // ---- Redis (8.6.2 on Railway, ioredis 5 client — see ADR-006) ----
  REDIS_URL: z.url({ error: 'REDIS_URL must be a valid connection URL' }),

  // ---- Auth ----
  JWT_SECRET: z.string().min(32, { error: 'JWT_SECRET must be at least 32 characters' }),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  // Optional comma-separated list of additional Google OAuth client IDs
  // (Android, iOS) whose tokens the backend should also accept.
  GOOGLE_OAUTH_MOBILE_CLIENT_IDS: z
    .string()
    .default('')
    .transform((v) => (v ? v.split(',').map((id) => id.trim()).filter(Boolean) : [])),

  // ---- MSG91 (direct REST v5 — see ADR-004) ----
  MSG91_AUTH_KEY: z.string().min(1),
  MSG91_OTP_TEMPLATE_ID: z.string().min(1),
  MSG91_SENDER_ID: z.string().min(1),

  // ---- Cashfree (cashfree-pg SDK — see ADR-004) ----
  CASHFREE_APP_ID: z.string().min(1),
  CASHFREE_SECRET_KEY: z.string().min(1),
  CASHFREE_ENV: z.enum(['SANDBOX', 'PRODUCTION']).default('SANDBOX'),
  CASHFREE_WEBHOOK_SECRET: z.string().min(1),

  // ---- Delhivery (direct REST — see ADR-004) ----
  DELHIVERY_API_TOKEN: z.string().min(1),
  DELHIVERY_BASE_URL: z.url().default('https://track.delhivery.com'),

  // ---- Cloudflare R2 (S3-compatible — see ADR-003) ----
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  R2_PUBLIC_BASE_URL: z.url(),

  // ---- Business rules (server-authoritative — see @GUARD Risk #3) ----
  FREE_DELIVERY_THRESHOLD_PAISE: z.coerce.number().int().default(300000),
  FIRST_ORDER_DISCOUNT_PERCENT: z.coerce.number().int().min(0).max(100).default(10),
  REFERRAL_CREDIT_PAISE: z.coerce.number().int().default(10000),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Passed to ConfigModule.forRoot({ validate }). Throws on invalid config,
 * which aborts bootstrap.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}
