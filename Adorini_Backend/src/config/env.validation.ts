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
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
        : [],
    ),

  // ---- OTP (self-managed: we generate the code, MSG91 only delivers it) ----
  /** How long a code stays valid. Long enough for a slow SMS, short enough to limit exposure. */
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  /**
   * Verification attempts before the code is destroyed. This — not the stored
   * hash — is the real defence against brute-forcing a 6-digit code.
   */
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  /** Minimum gap between OTP sends to one number. */
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  /** Hard cap per number per hour. Every SMS costs real money. */
  OTP_MAX_REQUESTS_PER_HOUR: z.coerce.number().int().positive().default(5),

  /**
   * Lifetime of the opaque token handed out when Google sign-in finds no
   * account and the user must still verify a phone to finish registering.
   */
  REGISTRATION_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(600),

  // ---- MSG91 (direct REST v5 — see ADR-004) ----
  MSG91_AUTH_KEY: z.string().min(1),
  MSG91_OTP_TEMPLATE_ID: z.string().min(1),
  /** 6-character DLT-approved SMS sender header, e.g. `ADORNI`. */
  MSG91_SENDER_ID: z.string().min(1),
  /**
   * WhatsApp Business phone number registered with MSG91, in international
   * format without `+` (e.g. `919876543210`).
   *
   * Deliberately separate from `MSG91_SENDER_ID` — that is an SMS sender
   * header, this is a phone number on a different channel. Passing one where
   * the other belongs fails only against a live account, never in tests.
   */
  MSG91_WHATSAPP_NUMBER: z.string().min(1),

  // ---- Cashfree (cashfree-pg SDK — see ADR-004) ----
  CASHFREE_APP_ID: z.string().min(1),
  CASHFREE_SECRET_KEY: z.string().min(1),
  CASHFREE_ENV: z.enum(['SANDBOX', 'PRODUCTION']).default('SANDBOX'),
  CASHFREE_WEBHOOK_SECRET: z.string().min(1),

  // ---- Delhivery (direct REST — see ADR-004) ----
  DELHIVERY_API_TOKEN: z.string().min(1),
  DELHIVERY_BASE_URL: z.url().default('https://track.delhivery.com'),

  /**
   * Shared secrets for the inbound Delhivery and MSG91 webhook endpoints.
   *
   * Neither provider signs its callbacks the way Cashfree does (HMAC over the
   * raw body), so a bearer token we generate and register in their dashboards is
   * the available authentication. These endpoints move order state and trigger
   * wallet credits, so leaving them open is not an option — hence required, and
   * long enough that guessing is not a strategy.
   */
  DELHIVERY_WEBHOOK_TOKEN: z
    .string()
    .min(24, { error: 'DELHIVERY_WEBHOOK_TOKEN must be at least 24 characters' }),
  MSG91_WEBHOOK_TOKEN: z
    .string()
    .min(24, { error: 'MSG91_WEBHOOK_TOKEN must be at least 24 characters' }),

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
 * Secrets that must be real before this application may serve production
 * traffic. Every one of them is a credential for an outbound integration; a
 * placeholder in any of them means that integration is silently dead.
 */
const PRODUCTION_REQUIRED_SECRETS = [
  'JWT_SECRET',
  'GOOGLE_OAUTH_CLIENT_ID',
  'MSG91_AUTH_KEY',
  'MSG91_OTP_TEMPLATE_ID',
  'MSG91_SENDER_ID',
  'MSG91_WHATSAPP_NUMBER',
  'CASHFREE_APP_ID',
  'CASHFREE_SECRET_KEY',
  'CASHFREE_WEBHOOK_SECRET',
  'DELHIVERY_API_TOKEN',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const satisfies readonly (keyof Env)[];

/**
 * Values that are obviously not real credentials.
 *
 * Motivated by a live finding: MSG91's OTP endpoint answers **HTTP 200
 * `{"type":"success"}` even for a completely invalid auth key and template id**.
 * A misconfigured SMS integration therefore looks perfectly healthy from its
 * own responses — no amount of provider-side error handling can detect it,
 * because the provider reports success.
 *
 * Since the provider will not tell us, the check has to happen before we ever
 * call it: a deployment carrying placeholder credentials must fail to start
 * rather than run and quietly deliver no OTPs at all.
 */
const PLACEHOLDER_PATTERNS = [
  /placeholder/i,
  /^change[-_ ]?me$/i,
  /^replace[-_ ]?with/i,
  /^your[-_ ]/i,
  /^todo$/i,
  /^xxx+$/i,
  /^test[-_]?(key|secret|token)$/i,
];

function looksLikePlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

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

  const env = result.data;

  // Development and test deliberately run on placeholders — the providers are
  // stubbed there, and demanding real credentials to run the test suite would
  // mean nobody could run it.
  if (env.NODE_ENV === 'production') {
    const offenders = PRODUCTION_REQUIRED_SECRETS.filter((key) =>
      looksLikePlaceholder(String(env[key])),
    );

    if (offenders.length > 0) {
      throw new Error(
        [
          'Refusing to start in production with placeholder credentials:',
          ...offenders.map((key) => `  - ${key}`),
          '',
          'These are outbound integration secrets. MSG91 in particular reports',
          'success for invalid credentials, so a placeholder here would not',
          'surface as an error — OTPs would simply never arrive.',
        ].join('\n'),
      );
    }
  }

  return env;
}
