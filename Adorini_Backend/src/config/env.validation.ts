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

  /**
   * Comma-separated browser origins allowed to call the API.
   *
   * Empty by default, and that default is correct for the mobile app: CORS is a
   * browser mechanism, so a Flutter Android/iOS client is unaffected by it
   * entirely. Only fill this in for something that genuinely runs in a browser —
   * Flutter web, or an admin panel.
   */
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean)
        : [],
    ),

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

  // ---- OTP (self-managed: we generate the code, WhatsApp only delivers it) ----
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

  // ---- Meta WhatsApp Business Cloud API (direct REST, no BSP) ----
  /**
   * Permanent System User access token (Business Settings → System Users) —
   * deliberately NOT the 24h temporary token the developer console hands out
   * for quick testing, which would expire in production without warning.
   */
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  /** Graph API "phone number ID" object id — not the WhatsApp number string itself. */
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  /**
   * WhatsApp Business Account id. Not read by any send/receive call — Graph
   * API sends only need `WHATSAPP_PHONE_NUMBER_ID` — kept here because
   * template-management tooling and the webhook-subscription screen both key
   * off it, and it is cheap to have on hand rather than re-deriving it from
   * the dashboard on the next incident.
   */
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().min(1),
  /** Meta app secret. HMACs the `X-Hub-Signature-256` header on inbound webhooks. */
  WHATSAPP_APP_SECRET: z.string().min(1),
  /**
   * Arbitrary string this app chooses and Meta echoes back during the webhook
   * verification handshake (`hub.verify_token`). Not a credential Meta
   * issues — generated locally, pasted into the Meta dashboard's webhook
   * configuration screen once.
   */
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z
    .string()
    .min(24, { error: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN must be at least 24 characters' }),
  /** Graph API version. Meta deprecates versions on a rolling schedule; bump via env, not a redeploy. */
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  /**
   * Approved Authentication-category template used for OTP delivery.
   *
   * OTP delivery is WhatsApp-only — MSG91 and its SMS fallback have been
   * dropped entirely. A phone number with no active WhatsApp account cannot
   * receive a code and cannot log in or complete a COD checkout. See the
   * known-gap note on `WhatsAppService.sendOtp`.
   */
  WHATSAPP_OTP_TEMPLATE_NAME: z.string().min(1),
  /** Template language code, e.g. `en` — must match what was submitted for approval. */
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default('en'),

  // ---- Cashfree (cashfree-pg SDK — see ADR-004) ----
  CASHFREE_APP_ID: z.string().min(1),
  CASHFREE_SECRET_KEY: z.string().min(1),
  CASHFREE_ENV: z.enum(['SANDBOX', 'PRODUCTION']).default('SANDBOX'),
  CASHFREE_WEBHOOK_SECRET: z.string().min(1),

  // ---- Delhivery (direct REST — see ADR-004) ----
  DELHIVERY_API_TOKEN: z.string().min(1),
  DELHIVERY_BASE_URL: z.url().default('https://track.delhivery.com'),

  /**
   * Shared secret for the inbound Delhivery webhook endpoint.
   *
   * Delhivery does not sign its callbacks the way Cashfree (or now Meta) does
   * with an HMAC over the raw body, so a bearer token we generate and register
   * in its dashboard is the available authentication. This endpoint moves
   * order state, so leaving it open is not an option — hence required, and
   * long enough that guessing is not a strategy.
   */
  DELHIVERY_WEBHOOK_TOKEN: z
    .string()
    .min(24, { error: 'DELHIVERY_WEBHOOK_TOKEN must be at least 24 characters' }),

  // ---- Cloudflare R2 (S3-compatible — see ADR-003) ----
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  R2_PUBLIC_BASE_URL: z.url(),

  // ---- Business rules (server-authoritative — see @GUARD Risk #3) ----
  FREE_DELIVERY_THRESHOLD_PAISE: z.coerce.number().int().default(300000),
  /**
   * Delivery charged on orders below the free-delivery threshold.
   *
   * ⚠️ The ₹49 default is a placeholder — the PRD fixes the *threshold*
   * (₹3,000) but never states the fee itself. Confirm the real number with the
   * business before launch; it is charged to every buyer under the threshold.
   */
  DELIVERY_FEE_PAISE: z.coerce.number().int().nonnegative().default(4900),
  FIRST_ORDER_DISCOUNT_PERCENT: z.coerce.number().int().min(0).max(100).default(10),
  REFERRAL_CREDIT_PAISE: z.coerce.number().int().default(10000),

  // ---- Scheduled jobs ----
  /**
   * How long a COD order may sit in `PENDING_VERIFICATION` before the sweep
   * auto-cancels it and releases the stock it is holding. 24h default: long
   * enough for a buyer who missed the SMS to notice and retry via
   * `resend-cod`, short enough that abandoned intent doesn't hold inventory
   * indefinitely.
   */
  COD_VERIFICATION_TIMEOUT_HOURS: z.coerce.number().int().positive().default(24),

  /**
   * How long a buyer has to answer the "we could not deliver — do you still
   * want it?" WhatsApp message before the order is cancelled.
   *
   * Measured from the failed attempt, not from the message send: 24 hours from
   * the attempt gives everyone the same window, whereas "until midnight" would
   * hand an 8pm failure four hours, most of them while the buyer is asleep.
   */
  DELIVERY_RESPONSE_WINDOW_HOURS: z.coerce.number().int().positive().default(24),

  /**
   * Total courier hand-over attempts allowed before the parcel returns to
   * origin. Delhivery itself caps reattempts, so offering a buyer an unlimited
   * "try again" would promise something the courier will not honour.
   */
  MAX_DELIVERY_ATTEMPTS: z.coerce.number().int().positive().default(3),

  /**
   * Approved Utility-category WhatsApp template for the failed-delivery
   * prompt. WhatsApp requires business-initiated messages to use a
   * Meta-approved template, so this cannot be free text — the template must
   * be submitted and approved before the flow works against a live account.
   */
  WHATSAPP_DELIVERY_RETRY_TEMPLATE: z.string().min(1).default('adorini_delivery_retry'),
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
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  'WHATSAPP_OTP_TEMPLATE_NAME',
  'CASHFREE_APP_ID',
  'CASHFREE_SECRET_KEY',
  'CASHFREE_WEBHOOK_SECRET',
  'DELHIVERY_API_TOKEN',
  // Delhivery does not sign its callbacks, so this shared secret is the only
  // thing separating a real webhook from a forged one.
  'DELHIVERY_WEBHOOK_TOKEN',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const satisfies readonly (keyof Env)[];

/**
 * Values that are obviously not real credentials.
 *
 * Originally motivated by a live finding against MSG91 (since dropped): its
 * OTP endpoint answered **HTTP 200 `{"type":"success"}` even for a completely
 * invalid auth key**, so a misconfigured integration looked perfectly healthy
 * from its own responses. Meta's Graph API returns real error objects on bad
 * credentials, so it is not as silent a failure mode — but the discipline of
 * refusing to boot production with placeholder secrets is kept regardless:
 * the check has to happen before we ever call an outbound integration, so a
 * deployment carrying placeholder credentials fails to start rather than
 * running and quietly delivering no OTPs at all.
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

export function looksLikePlaceholder(value: string): boolean {
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
          'These are outbound integration secrets. A placeholder here would not',
          'fail loudly until the first real send attempt — OTPs and WhatsApp',
          'notifications would simply never arrive in the meantime.',
        ].join('\n'),
      );
    }
  }

  return env;
}
