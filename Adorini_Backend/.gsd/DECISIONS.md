# DECISIONS.md — Architecture Decision Record

## ADR-001: TypeORM 1.1.0 over Prisma

**Date**: 2026-08-10 · **Status**: Accepted

Prior context said "TypeORM/Prisma" ambiguously. Resolved to TypeORM. Rationale: TypeORM reached 1.0 in June 2026, removing the pre-1.0 maintenance risk that previously argued against it. Adorini's dynamic `size_rules` JSONB fit-logic and catalog filter queries need QueryBuilder / raw-SQL escape hatches that Prisma's JSONB API still handles awkwardly. Decorator-based entities also match NestJS idiom.

**Consequence**: Explicit `leftJoinAndSelect` discipline required on catalog/PDP reads (see @GUARD Risk #4) — TypeORM's lazy relations otherwise produce N+1.

## ADR-002: Pin to stable versions, reject pre-GA

**Date**: 2026-08-10 · **Status**: Accepted

Node 24.x LTS (not 26, which isn't LTS until Oct 2026), NestJS v11.1.28 (not v12, a Q3-2026 draft roadmap involving full ESM + Jest→Vitest + ESLint→oxlint migration), PostgreSQL 18.4 (not 19, still beta).

**Rationale**: This is a payments- and COD-adjacent system handling real money. Ecosystem maturity beats novelty. **Revisit** NestJS v12 after GA + ecosystem catch-up.

## ADR-003: Two-vendor infra — Railway + Cloudflare, no AWS

**Date**: 2026-08-10 · **Status**: Accepted

Cloudflare R2 for media ($0.015/GB-month, **$0 egress**) vs S3 (~$0.09/GB egress) — decisive for a media-heavy PDP gallery + buyer review photo/video read pattern. Cloudflare proxied DNS + Cache Rules + WAF sits in front of the Railway origin, giving CDN and edge rate-limiting without a second CDN bill.

**Rejected**: AWS compute/CDN (no capability gap it fills; adds a second cloud bill and ops surface). Cloudflare Tunnel / Zero Trust (protects self-hosted origins; Railway is managed PaaS that already terminates TLS).

**Revisit if**: transactional email volume grows (AWS SES specifically, single-purpose), or a component moves off Railway to self-hosted infra (then Tunnel applies).

**Consequence**: Cart/checkout/order routes must set `Cache-Control: no-store` — an edge cache must never serve another user's cart.

## ADR-004: Direct REST for MSG91 and Delhivery, official SDK for Cashfree

**Date**: 2026-08-10 · **Status**: Accepted

MSG91's npm ecosystem (`msg91`, `msg91-sdk`, `@msg91comm/otp`, `sendotp`) is a set of thin, inconsistently-maintained community wrappers with no clear official choice; Delhivery publishes no SDK. Both are called via thin internal providers over REST — equivalent effort, no unmaintained-dependency risk. For Cashfree, `@cashfreepayments/cashfree-sdk` is deprecated and targets legacy endpoints; use official `cashfree-pg` (v6.0.4+).

## ADR-006: ioredis 5.x, not 6.x

**Date**: 2026-08-10 · **Status**: Accepted · **Forced by**: install-time dependency conflict

TypeORM 1.1.0 declares `peerOptional ioredis@^5.0.4` and does not yet support ioredis 6 (released ~10 days prior). npm refused to resolve the tree.

**Rejected**: `--legacy-peer-deps` / `--force` — that suppresses the warning without making the combination actually supported.

**Chosen**: pin `ioredis@^5.4.2`. Consistent with ADR-002 (ecosystem maturity over novelty). TypeORM's ioredis peer only matters for its built-in Redis query cache, which Adorini does not use — Redis is accessed directly via `providers/redis/` — but matching the supported version keeps the dependency tree honest.

**Revisit when**: TypeORM widens its ioredis peer range to `^6`.

## ADR-007: Zod as the single validation system, via `nestjs-zod`

**Date**: 2026-08-10 · **Status**: Accepted · **Forced by**: boot failure

NestJS's stock `ValidationPipe` requires `class-validator` + `class-transformer`; the app crashed at bootstrap without them. Installing them alongside Zod would mean two validation systems — class-validator for DTOs, Zod for env — which is incoherent and violates the @BE constraint "input validation (Zod)".

**Chosen**: `nestjs-zod@^5.5.0` (peer-compatible with `zod@^4`, `@nestjs/common@^11`, `@nestjs/swagger@^11`). Provides `ZodValidationPipe` (registered globally, replacing `ValidationPipe`) and `createZodDto` for DTOs.

**API note**: v5 removed `patchNestJsSwagger()`. Swagger integration is now `cleanupOpenApiDoc(SwaggerModule.createDocument(...))`, which resolves Zod-derived schemas into real OpenAPI definitions. Verified working — `/docs-json` returns a valid OpenAPI 3.0.0 document.

**Consequence**: all DTOs from Phase 4 onward use `createZodDto(schema)`, never `class-validator` decorators.

## ADR-008: Referral records outlive the accounts they reference

**Date**: 2026-08-11 · **Status**: Accepted · **Forced by**: a failing integration test

`Referral.referrer` and `Referral.referee` were initially `ON DELETE CASCADE`. The test for @GUARD Risk #6 — delete the account, sign up again on the same phone, attempt a second referral — **passed the insert**, because deleting the user cascaded the referral row away and took the `referee_phone` claim with it. The `uq_referral_referee_phone` constraint was real but had nothing left to conflict against.

**Chosen**: both user FKs become `ON DELETE SET NULL`, with `referrer_id`/`referee_id` nullable. The referral is an anti-abuse and accounting record; it has to survive the accounts it references. `chk_referral_no_self_referral` still holds — `NULL <> NULL` is `NULL`, which a CHECK treats as satisfied, and a self-referral requires both columns populated and equal.

**Rejected**: keeping `CASCADE` and documenting the weaker guarantee. The constraint was mandated specifically to stop this attack; leaving it decorative would be worse than not having it, because the risk register would record it as mitigated.

**Consequence**: `referee_phone` is retained after account deletion. That is a deliberate trade of data minimisation for fraud prevention and is **flagged for the @ETHICS gate** — a salted hash would preserve the uniqueness property while holding less personal data. Phase 4 services must treat `referrerId`/`refereeId` as nullable and void a referral whose referrer is gone.

## ADR-009: `gen_random_uuid()` via `uuidExtension: 'pgcrypto'`

**Date**: 2026-08-11 · **Status**: Accepted · **Forced by**: an unrunnable generated migration

TypeORM's default UUID primary key emits `uuid_generate_v4()`, which lives in the `uuid-ossp` extension — but the generated migration contains no `CREATE EXTENSION`, so it fails against a fresh database. Discovered by reading the generated SQL before running it.

**Chosen**: set `uuidExtension: 'pgcrypto'` on both the CLI DataSource and the app's TypeORM options, which makes TypeORM emit `gen_random_uuid()`. That function has been core PostgreSQL since 13, so it needs no extension and no superuser rights at deploy time — relevant on Railway, where extension privileges are not guaranteed.

**Rejected**: adding `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` to the migration — it needs superuser rights and buys nothing over a core function.

## ADR-010: npm `overrides` to lift transitive pins — `js-yaml` and `axios`

**Date**: 2026-08-12 · **Status**: Accepted

Two dependencies are forced above what their parents ask for:

- **`js-yaml: ^5.2.3`** — `@nestjs/swagger` pulled a version inside the advisory range for GHSA-pm4m-ph32-ghv5 (high, DoS via exponential parsing in flow collections). `npm audit fix` had no non-breaking path.
- **`axios: ^1.19.0`** — `cashfree-pg@6.0.4` declares `"axios": "1.15.0"` as an **exact** version, with no caret. Left alone, the payments SDK pins the whole tree to a single axios build that can never receive a patch, and any future axios advisory would be unfixable without waiting for Cashfree to publish a new SDK.

**Chosen**: pin both via `overrides`. `npm audit` reports 0 vulnerabilities.

**Note for reviewers**: an unexplained `overrides` entry looks like dead weight — a Phase 3 audit initially flagged `axios` as an unused dependency that should be deleted, because nothing in `src/` imports it. It is not a dependency at all; it is a version floor on a transitive one. Removing it silently downgrades axios to 1.15.0.

**Revisit when**: `cashfree-pg` widens its axios range (then the override can go), or `@nestjs/swagger` ships a patched `js-yaml`.

## ADR-011: Every outbound call carries a deadline

**Date**: 2026-08-12 · **Status**: Accepted · **Forced by**: Phase 3 audit

`fetch` has no default timeout. Every provider called MSG91, Delhivery and Google without one, so an upstream that accepted a connection and then stalled would hold the request until the socket died — potentially minutes. For a COD/payments system that is the *worst* failure mode: it is the opposite of the "fail loudly" property the providers are specified to have, because it fails silently by hanging, holding a Node handle and a database connection each time.

**Chosen**: `src/common/http/fetch-with-timeout.ts` wraps `fetch` with `AbortSignal.timeout()` and raises `UpstreamTimeoutError`, which each provider converts into its own typed error. Budgets are set per upstream by how much a caller can afford to wait — 7s for MSG91 and Google (a buyer is watching), 15s for Delhivery (background jobs and webhooks). The R2 `S3Client` gets `connectionTimeout`/`requestTimeout` via `NodeHttpHandler` and `maxAttempts: 2`, since the SDK's own default is effectively no request timeout.

**Consequence**: timeouts are distinguishable from transport failures (`UpstreamTimeoutError` vs a plain unreachable error), because the two justify different retry behaviour in Phase 4.

## ADR-012: Google starts registration; a verified phone completes it

**Date**: 2026-08-12 · **Status**: Accepted

`users.phone` is `NOT NULL UNIQUE` — verified against the live database — and it stays that way. It is what COD OTP verification, one-account-per-phone, and `uq_referral_referee_phone` all rest on. Google returns an email and a `googleId`, never a phone, so **Google alone cannot create an account**.

**Chosen**: a two-step flow. `POST /auth/google` returns a discriminated 200 — `AUTHENTICATED` when the `googleId` or a *verified* email already matches a user, otherwise `PHONE_REQUIRED` with an opaque `registrationToken`. The client then runs the normal OTP flow passing that token, and `POST /auth/otp/verify` creates the account with `googleId` and `phone` together. That endpoint is therefore the **only** path in the system that creates a user.

**Rejected**: making `phone` nullable (breaks the identity model three other features depend on); returning 409 for the no-account case (needing a phone is the next step of a flow, not an error — a discriminated union is what a typed Flutter client wants).

**Email matching requires `email_verified`.** An unverified Google email is an unproven claim; honouring it would let anyone who can set their Google profile email seize the matching Adorini account.

**Registration tokens are opaque and Redis-backed, not JWTs** — a JWT is signed but readable, so Google's email and name would travel through client storage and logs in the clear, and a JWT can be replayed as a bearer token if any verifier forgets to check a `typ` claim. An opaque random string is structurally incapable of that. It is stored by hash, single-use, and deleted on redemption.

## ADR-013: Fail-closed global auth guard

**Date**: 2026-08-12 · **Status**: Accepted

`JwtAuthGuard` is registered via `APP_GUARD`, so **every route is authenticated unless it carries `@Public()`**.

**Rationale**: the two failure modes are not symmetric. Forgetting `@Public()` produces an immediate, obvious 401 in development. Forgetting `@UseGuards()` under an opt-in scheme produces a silently unauthenticated endpoint — the failure nobody notices until it is a data leak.

**Consequence**: every genuinely public endpoint from here on (catalog browsing, PDP, search) must remember `@Public()`. Both health probes already carry it.

**Access tokens carry only `sub`.** A JWT is signed, not encrypted, so phone/email would be readable by anything logging an `Authorization` header, and an embedded `isAdmin` would freeze a privilege decision for the token's lifetime. The guard therefore performs no database read, at the cost that a deleted user retains access for up to the 15-minute token lifetime. Accepted for MVP.

## ADR-014: Self-managed OTP, with the attempt cap as the real control

**Date**: 2026-08-12 · **Status**: Accepted

We generate the code, store it in Redis, and use MSG91 purely for delivery (`sendOtp` accepts an explicit OTP). Verification is a local Redis comparison, so login does not depend on MSG91 being reachable at verify time, and expiry/attempt/lockout policy is ours rather than theirs.

The stored value is an **HMAC keyed with `JWT_SECRET`**, not a bare SHA-256: a 6-digit code is only 10⁶ possibilities and a plain hash of it is reversible by anyone who can read Redis. But the honest security argument is that **no hash choice makes a million-space secret safe** — the real control is the attempt counter, which destroys the code after `OTP_MAX_ATTEMPTS`, forcing the attacker to buy a new SMS that the hourly cap then rations.

**Consequence**: Redis is now on the login critical path. If Redis is down, OTP login is down — surfaced as a 503 (verified live), not a 500.

**Operational caveat discovered during verification**: MSG91's `/api/v5/otp` returns **HTTP 200 `{"type":"success"}` even for a completely invalid auth key and template id**. A misconfigured MSG91 therefore looks perfectly healthy from the response alone. Delivery cannot be confirmed at send time; the credential smoke test must verify an SMS actually arrives.

## ADR-015: Referral capture at signup, outside the signup transaction

**Date**: 2026-08-12 · **Status**: Accepted

Signup is the only moment a referral code can be captured, so `auth` records it — but **after** the User+Wallet transaction commits, in its own try/catch.

**Why not inside**: in PostgreSQL a single failed statement aborts the entire surrounding transaction. A duplicate-referral insert inside the signup transaction would destroy the account creation. A referral is a bonus; it must never be able to stop someone registering.

Unknown codes and already-referred phones both yield `referralApplied: false` with the signup still succeeding. Hitting `uq_referral_referee_phone` is the ADR-008 anti-abuse rule working — the phone was referred before, possibly under a since-deleted account — not an error.

Nothing is credited here. Payout on `DELIVERED` belongs to `wallet`/`webhooks` (@GUARD Risk #1).

## ADR-005: Backend-first build, Flutter integrates after

**Date**: 2026-08-10 · **Status**: Accepted

Deviates from the MAS pipeline's parallel `@FE + @BE`. Accepted because NestJS auto-generates OpenAPI/Swagger from controllers + DTOs, so the contract is live and testable before any client exists, and the UI design spec is already locked.

**Mitigation for the deferred-integration risk**: each module is verified against its own Swagger doc at completion — response shapes checked against the known screen requirements module-by-module, not deferred to one end-of-build integration pass.

## ADR-010: Cursor-based pagination for the catalog, and full-text search via a dedicated migration

**Date**: 2026-08-12 · **Status**: Accepted

The PRD specifies "infinite scroll" for the catalog grid but never picks cursor vs. offset pagination, and STATE.md flagged full-text search as explicitly deferred out of the Phase 2 `InitialSchema` migration into Phase 4.

**Chosen — pagination**: opaque seek cursors (base64url of `{sortValue, id}`), decoded in `CatalogService` against whichever indexed column the active sort mode orders by (`created_at` for `newest`, `price_paise` for `price_asc`/`price_desc`), with `product.id` as a tie-breaker. Offset/`LIMIT..OFFSET` was rejected: a product inserted, deactivated, or repriced between two scroll requests shifts every row after it, so an offset-paginated feed would skip or repeat items mid-scroll — exactly what infinite scroll is supposed to hide from the user.

**Chosen — search**: a new migration (`AddProductSearchVector`) adds a `products.search_vector` tsvector column maintained by a `BEFORE INSERT OR UPDATE` trigger (not application code, so it can never drift from `name`/`description`), backed by a GIN index. Queried via `plainto_tsquery('english', :q)`, which is injection-safe (parameterised) and forgiving of raw user input (no tsquery syntax to escape), rather than `to_tsquery` (rejects malformed operator syntax) or a slow `ILIKE '%...%'` scan.

**Consequence (catalog)**: `search_vector` is intentionally absent from the `Product` entity — it is written by the trigger and read only via raw SQL in `CatalogService`, so there is nothing for TypeORM to hydrate and no risk of the ORM writing a stale value over it.

## ADR-011: Shared-secret auth for Delhivery and MSG91 webhooks

**Date**: 2026-08-12 · **Status**: Accepted

Cashfree signs its callbacks (HMAC-SHA256 over `timestamp + rawBody`), and `PaymentsService.verifyWebhookSignature` already checks it. Delhivery and MSG91 do not sign at all — but their endpoints move order state and trigger a ₹100 wallet credit, so leaving them unauthenticated was not an option.

**Chosen**: a shared secret we generate and register in each provider's dashboard, returned in an `x-adorini-webhook-token` header and compared with `crypto.timingSafeEqual`. Two new required env vars, `DELHIVERY_WEBHOOK_TOKEN` and `MSG91_WEBHOOK_TOKEN`, both min 24 chars. Constant-time comparison specifically because these routes are `@SkipThrottle()` — a plain `!==` on an unthrottled endpoint leaks the secret a byte at a time through response timing.

**Rejected**: IP allow-listing alone (Cloudflare sits in front, and courier egress ranges change without notice); no auth with "the payload is unguessable" reasoning (waybill numbers are printed on parcels).

**Consequence**: `NestFactory.create` now sets `rawBody: true`, because Cashfree signs the exact bytes sent and verifying against a re-serialised body fails on any key-order difference.

## ADR-012: Webhooks answer 2xx for duplicates, unmatched entities, and no-op events

**Date**: 2026-08-12 · **Status**: Accepted

All three providers redeliver on any non-2xx. An error response for "already processed" or "no order matches this waybill" therefore buys an indefinite retry loop against a condition retrying cannot fix.

**Chosen**: authenticated requests return `200` with an `outcome` discriminator — `processed`, `duplicate`, `ignored` (recorded, no action for this event type), or `unmatched` (no local entity; payload retained for reconciliation). Only genuine faults are non-2xx: `401` for bad signature/token, `400` for an unparseable payload, and `409` for an **illegal state transition**, which SPEC requires be rejected rather than silently ignored — that one *should* retry after a human looks at it, and its marker row rolls back with the transaction so a corrected redelivery can still apply.

**Consequence**: a repeat of the *current* status is a no-op rather than an error (`TransitionResult.changed === false`). Couriers emit several scans with the same status, and treating those as illegal would turn routine tracking noise into failed webhooks. The referral payout is gated on `changed`, so only the transition that actually delivered the order can pay out.
