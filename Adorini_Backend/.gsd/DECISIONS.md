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

**Date**: 2026-08-10 · **Status**: Accepted · **MSG91 half superseded by ADR-036**

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

**Date**: 2026-08-12 · **Status**: Accepted · **Delivery channel superseded by ADR-036** (self-managed generation/verification described here is unchanged)

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

## ADR-016: `@Public()` is a load-bearing declaration, and it is tested

**Date**: 2026-08-12 · **Status**: Accepted · **Forced by**: the entire storefront returning 401

The fail-closed global guard (ADR-013) has a sharp edge, and it cut immediately. `catalog`, `pdp` and `webhooks` were built in parallel with auth and shipped without `@Public()`. The result, verified live: **every storefront route returned 401**, and **all three provider webhooks were rejected with "Missing bearer token"** before reaching their own signature and shared-secret checks. Cashfree and Delhivery would have retried, given up, and left payments unconfirmed and referrals unpaid.

Nothing in the unit suite could catch it — each controller was correct, the guard was correct, only the *composition* was wrong.

**Chosen**: keep fail-closed (a forgotten `@Public()` is a loud 401; the opt-in alternative fails by silently exposing data), and add `common/guards/public-routes.integration.spec.ts`, which asserts the public surface against the real `AppModule`. It distinguishes the guard's own rejection ("Missing bearer token") from an endpoint's own authentication, so a webhook route that regresses is caught even though it still answers 401.

**Consequence**: every new public-facing controller needs `@Public()` *and* an entry in that spec.

## ADR-017: Public routes still identify the caller

**Date**: 2026-08-12 · **Status**: Accepted

`@Public()` originally short-circuited the guard entirely, so `request.user` was never populated even when a valid token was sent. That made "public" mean "anonymous", which is wrong for routes that work either way: `SizeEnquiry.userId` is nullable so a first-time visitor can ask about a size, but an enquiry from a known customer should reach the admin inbox attached to their account.

**Chosen**: on a public route the guard still decodes a supplied token on a best-effort basis and attaches the user. An invalid or expired token is ignored rather than rejected — the endpoint never required authentication, and rejecting would make a stale session *worse* than no session on a public page. `@OptionalUser()` exposes it, kept separate from `@CurrentUser()` so a handler that genuinely requires a user cannot start accepting anonymous callers by changing an argument.

## ADR-018: Referral payout resolves through the referee, not only an order link

**Date**: 2026-08-12 · **Status**: Accepted · **Forced by**: a silent no-op

`WalletCreditService` looked referrals up by `qualifyingOrderId`, but **nothing writes that column**: signup records the referral before any order exists, and order placement lives in `checkout`, which is not built. Every payout would have found nothing. The feature would have looked complete, cost nothing, and paid no one — and no test would have caught it, because the module meant to set the link does not exist to be tested.

**Chosen**: resolve the explicit link first, then fall back to the referee's own `PENDING` referral via the order's buyer, recording `qualifyingOrderId` when the fallback matches. The fallback also expresses the business rule more directly — the reward is for the referee's first *delivered* order, and the `PENDING` filter says exactly that, since a paid referral becomes `CREDITED` and later deliveries match nothing.

## ADR-019: Hand-parsed schemas map to 400, not 500

**Date**: 2026-08-12 · **Status**: Accepted

The webhook controllers call `schema.parse()` directly — they must authenticate the caller before trusting the body enough to validate it — so `ZodValidationPipe`, which only covers `@Body()` DTOs, never sees it. A raw `ZodError` escaped as a 500.

That is worse than untidy for webhooks specifically: a non-2xx tells the provider to redeliver, so a malformed payload would be retried indefinitely. `AllExceptionsFilter` now maps `ZodError` to **400**, which says "permanently bad, stop sending it".

## ADR-020: `search_vector` is mapped read-only so the drift check stays honest

**Date**: 2026-08-12 · **Status**: Accepted

The trigger-maintained `products.search_vector` column was deliberately left off the entity. The cost only showed up in `migration:generate`, which treated it as drift and emitted `DROP COLUMN "search_vector"` plus a drop of its GIN index — so the next unrelated migration anyone generated would have silently deleted full-text search, and the "no drift" check the project has used as a correctness signal since Phase 2 was permanently red.

**Chosen**: map it with `insert: false, update: false` (the trigger owns the value), `select: false` (keep a large tsvector out of every product read), and `@Index(..., { synchronize: false })` so TypeORM does not try to recreate a GIN index as a btree. Drift is clean again.

## ADR-021: Referral capture reports a reason, not just a boolean

**Date**: 2026-08-12 · **Status**: Accepted

`referralApplied: false` was returned for six distinct situations — no code given, a typo, a self-referral, a phone already referred, a sign-in rather than a signup, and an internal failure. The client could not tell them apart, so it could only ever show one message.

That collapses two cases needing **opposite advice**. Referral uniqueness is on the phone number and survives account deletion (ADR-008), so a buyer holding a genuinely valid code from a friend can legitimately hit "already referred" long after the fact. Told "invalid code", she retypes it, fails identically, and contacts support — while someone who actually made a typo sees the same thing and is given no reason to look closer.

**Chosen**: add `referralStatus: ReferralOutcome` alongside the boolean, covering every path: `APPLIED`, `NOT_PROVIDED`, `CODE_NOT_FOUND`, `SELF_REFERRAL`, `ALREADY_REFERRED`, `EXISTING_USER`, `UNAVAILABLE`. The boolean is retained for convenience and derived from the enum through a single helper, so the two cannot drift apart.

Named `ReferralOutcome` because `ReferralStatus` is already the persisted lifecycle (`PENDING` → `CREDITED`/`VOID`) in `domain.enums.ts`. This one is never stored — it describes a single signup attempt.

**Consequence**: the source of a code is explicitly irrelevant — a deep-link capture and a hand-typed code are the same request — but the *timing* is not. Referrals attach only at account creation, so the client must send the code with `otp/verify`; there is deliberately no endpoint to apply one afterwards, since that would let a code be claimed days later and is far harder to police.

## ADR-022: The cart stores no prices

**Date**: 2026-08-12 · **Status**: Accepted

`cart_items` holds a user, a variant and a quantity — nothing about money. Every price is read live from the catalogue on each cart read, and recomputed again under a row lock at placement.

**Rationale**: a stored price is a promise the checkout may refuse to keep. If an admin reprices a garment after it was added, a cached cart price would show one number and charge another — and the only way to make that consistent would be to honour the stale price, which is a business decision the code should not be making silently.

**Consequence**: a cart's total can change between visits. That is correct — the shop's price is the price — and the cart response carries live `stockQuantity` and `inStock` per line so the client can show what moved.

**Deviation from the approved architecture**: the plan specified "Redis session cache + Postgres sync" for the cart. Implemented as Postgres-only. Caching computed totals directly contradicts server-authoritative pricing (@GUARD Risk #3), and a cache that must be invalidated on every price, stock and catalogue change is a correctness liability for a saving that does not matter at MVP traffic. Revisit if cart reads become a measured bottleneck.

## ADR-023: One pricing implementation, shared by quote and placement

**Date**: 2026-08-12 · **Status**: Accepted

`PricingService` is the only place order money is computed. Both `GET /checkout/quote` and `POST /checkout/place` call it.

Two implementations would drift, and the drift would surface as a customer being charged something other than what they agreed to — the single worst class of bug in a commerce system. The service takes quantities and a wallet-credit *request*; it derives subtotal, discount, delivery and total itself. The `place` DTO has no price field of any kind, so there is nothing for a tampered payload to change (@GUARD Risk #3).

Two ordering decisions inside it are deliberate:
- **Free delivery is measured on the subtotal, before discount.** Measuring after would let a buyer's own first-order discount push a qualifying order back under the threshold and re-add a fee they were already told they had escaped.
- **Wallet credit is clamped to what is still owed**, not merely to the balance. Without that, a large balance on a small order produces a negative total, which `chk_order_amounts_non_negative` rejects at the final INSERT — after stock has already been taken.

## ADR-024: Stock is decremented conditionally, under a deterministic lock order

**Date**: 2026-08-12 · **Status**: Accepted

Placement locks every variant in the cart with `SELECT … FOR UPDATE`, **ordered by id**, then decrements with `WHERE stock_quantity >= :quantity` and checks the affected row count.

The lock ordering is not incidental: two carts sharing two variants in opposite orders would deadlock, and Postgres would abort one at random — turning a busy checkout into sporadic, unreproducible failures. Sorting the ids gives every transaction the same acquisition sequence.

The conditional `WHERE` is the actual oversell guard; `chk_variant_stock_non_negative` is the backstop beneath it. Products are joined but not locked, so unrelated carts sharing a product do not serialise.

## ADR-025: The exception filter preserves service-supplied error codes

**Date**: 2026-08-12 · **Status**: Accepted · **Forced by**: a failing integration test

Services throughout raise `{ code: 'ADDRESS_LOCKED', message: … }`, `INSUFFICIENT_STOCK`, `OTP_COOLDOWN`, `RETURN_WINDOW_CLOSED` and so on, so a client can branch on the reason. `AllExceptionsFilter` was overwriting every one of them with the generic status name — so `ADDRESS_LOCKED` reached the app as `CONFLICT`.

Nothing failed loudly. The API looked fine, returned the right status, and quietly discarded the entire machine-readable vocabulary the modules had been written around. Caught only because the commerce journey test asserted the code rather than the status.

**Chosen**: a `code` present on the thrown payload wins; the status name remains the fallback.

## ADR-026: Returns are per order line, and no money moves on review

**Date**: 2026-08-12 · **Status**: Accepted

A `ReturnRequest` references an `OrderItem`, not an `Order` — a buyer returning one of three kurtis must not mark the whole order returned. Returns are likewise **not** an `OrderStatus`: "was this ever delivered?" has to stay answerable from the order alone, because both the referral payout and the fit-accuracy signal hang off delivery.

The 3-day window is measured from `deliveredAt`, never from placement — measuring from placement would silently shrink the window by however long shipping took, so a slow delivery would cost the buyer their right to return.

**Approving a return moves no money.** Refunds need the Cashfree refund API for prepaid and a manual path for COD, neither of which exists yet. Issuing wallet credit instead would quietly convert a cash refund into store credit, which is a business decision rather than an implementation detail.

## ADR-027: `AdminGuard` reads `is_admin` per request

**Date**: 2026-08-12 · **Status**: Accepted

The admin guard queries the database on every request rather than trusting a token claim.

Access tokens carry only `sub` and live 15 minutes (ADR-013). An `isAdmin` claim would therefore keep working for a quarter of an hour after someone's access was revoked — and these endpoints can reprice the entire catalogue and read every buyer's contact details from the enquiry inbox. Admin traffic is low enough that the extra read costs nothing that matters.

## ADR-005: Backend-first build, Flutter integrates after

**Date**: 2026-08-10 · **Status**: Accepted

Deviates from the MAS pipeline's parallel `@FE + @BE`. Accepted because NestJS auto-generates OpenAPI/Swagger from controllers + DTOs, so the contract is live and testable before any client exists, and the UI design spec is already locked.

**Mitigation for the deferred-integration risk**: each module is verified against its own Swagger doc at completion — response shapes checked against the known screen requirements module-by-module, not deferred to one end-of-build integration pass.

## ADR-028: Cursor-based pagination for the catalog, and full-text search via a dedicated migration

**Date**: 2026-08-12 · **Status**: Accepted

The PRD specifies "infinite scroll" for the catalog grid but never picks cursor vs. offset pagination, and STATE.md flagged full-text search as explicitly deferred out of the Phase 2 `InitialSchema` migration into Phase 4.

**Chosen — pagination**: opaque seek cursors (base64url of `{sortValue, id}`), decoded in `CatalogService` against whichever indexed column the active sort mode orders by (`created_at` for `newest`, `price_paise` for `price_asc`/`price_desc`), with `product.id` as a tie-breaker. Offset/`LIMIT..OFFSET` was rejected: a product inserted, deactivated, or repriced between two scroll requests shifts every row after it, so an offset-paginated feed would skip or repeat items mid-scroll — exactly what infinite scroll is supposed to hide from the user.

**Chosen — search**: a new migration (`AddProductSearchVector`) adds a `products.search_vector` tsvector column maintained by a `BEFORE INSERT OR UPDATE` trigger (not application code, so it can never drift from `name`/`description`), backed by a GIN index. Queried via `plainto_tsquery('english', :q)`, which is injection-safe (parameterised) and forgiving of raw user input (no tsquery syntax to escape), rather than `to_tsquery` (rejects malformed operator syntax) or a slow `ILIKE '%...%'` scan.

**Consequence (catalog)**: `search_vector` is intentionally absent from the `Product` entity — it is written by the trigger and read only via raw SQL in `CatalogService`, so there is nothing for TypeORM to hydrate and no risk of the ORM writing a stale value over it.

## ADR-029: Shared-secret auth for Delhivery and MSG91 webhooks

**Date**: 2026-08-12 · **Status**: Accepted · **MSG91 half superseded by ADR-036** (WhatsApp inbound now uses Meta's HMAC-signed `X-Hub-Signature-256`, not a shared secret; Delhivery's half is unchanged)

Cashfree signs its callbacks (HMAC-SHA256 over `timestamp + rawBody`), and `PaymentsService.verifyWebhookSignature` already checks it. Delhivery and MSG91 do not sign at all — but their endpoints move order state and trigger a ₹100 wallet credit, so leaving them unauthenticated was not an option.

**Chosen**: a shared secret we generate and register in each provider's dashboard, returned in an `x-adorini-webhook-token` header and compared with `crypto.timingSafeEqual`. Two new required env vars, `DELHIVERY_WEBHOOK_TOKEN` and `MSG91_WEBHOOK_TOKEN`, both min 24 chars. Constant-time comparison specifically because these routes are `@SkipThrottle()` — a plain `!==` on an unthrottled endpoint leaks the secret a byte at a time through response timing.

**Rejected**: IP allow-listing alone (Cloudflare sits in front, and courier egress ranges change without notice); no auth with "the payload is unguessable" reasoning (waybill numbers are printed on parcels).

**Consequence**: `NestFactory.create` now sets `rawBody: true`, because Cashfree signs the exact bytes sent and verifying against a re-serialised body fails on any key-order difference.

## ADR-030: Webhooks answer 2xx for duplicates, unmatched entities, and no-op events

**Date**: 2026-08-12 · **Status**: Accepted

All three providers redeliver on any non-2xx. An error response for "already processed" or "no order matches this waybill" therefore buys an indefinite retry loop against a condition retrying cannot fix.

**Chosen**: authenticated requests return `200` with an `outcome` discriminator — `processed`, `duplicate`, `ignored` (recorded, no action for this event type), or `unmatched` (no local entity; payload retained for reconciliation). Only genuine faults are non-2xx: `401` for bad signature/token, `400` for an unparseable payload, and `409` for an **illegal state transition**, which SPEC requires be rejected rather than silently ignored — that one *should* retry after a human looks at it, and its marker row rolls back with the transaction so a corrected redelivery can still apply.

**Consequence**: a repeat of the *current* status is a no-op rather than an error (`TransitionResult.changed === false`). Couriers emit several scans with the same status, and treating those as illegal would turn routine tracking noise into failed webhooks. The referral payout is gated on `changed`, so only the transition that actually delivered the order can pay out.

## ADR-031: Videos MVP scope — feed and "shop this look" tags, no likes or comments

**Date**: 2026-08-12 · **Status**: Accepted

The PRD's reels feature lists a feed, a player, likes, comments, and "shop this look" product tags. Building all five was not warranted for an MVP whose core bet is discovery → trust → purchase, not social engagement.

**Chosen**: ship the feed and product tagging only — the part with an actual conversion path, a shopper watches a clip and taps through to a product. Likes and comments are deferred: they carry real moderation cost (abuse, spam) and no revenue path, and building them without moderation would be a liability, not a feature.

**Also chosen**: video uploads are MP4-only (`VIDEO_MIME_EXTENSIONS` has one entry), and the feed is strictly chronological — no `displayOrder` on `Video` (contrast `VideoProductTag.displayOrder`, which orders the small, admin-curated tag list under one video, where manual ordering is cheap to reason about and genuinely useful). A manual feed-curation override is easy to add later; nothing here forecloses it.

**Rejected**: building a `displayOrder` on `Video` up front for hypothetical future curation — every video seeded so far would default to `0`, so it would not yet do anything a real requirement asked for.

## ADR-032: Coupons do not stack with the first-order discount; no gift cards in scope

**Date**: 2026-08-12 · **Status**: Accepted

Coupons are a new checkout input alongside the existing first-order discount (ADR-023 established `PricingService` as the single place both quote and placement compute money — a coupon is just another input to that same function, not a second code path).

**Chosen — no stacking**: a buyer who qualifies for both a first-order discount and a coupon gets whichever is larger, never both added together. Nobody decided on purpose that these two promotions should compound, and unwinding an accidental stack after coupons ship is a margin conversation nobody wants to have. `PricingService.calculate` computes both and takes `Math.max`, reporting which one actually won via `discountSource` so the client labels it correctly.

**Chosen — redemption is per-user-once, enforced twice**: `uq_coupon_redemption_coupon_user` fixes the per-user limit at exactly one (no configurable per-user cap — the only case MVP needs), and `CouponsService.lockAndValidate` takes a `pessimistic_write` lock on the `Coupon` row before checking the global `maxRedemptions` count, so two concurrent checkouts racing for the last redemption slot serialise rather than both succeeding. The lock makes the check trustworthy; the unique constraint is what actually guarantees it if the lock is ever bypassed — the same two-layer pattern Risk #1's webhook idempotency uses.

**Chosen — redemption is recorded after pricing decides, not before**: the coupon is validated once under lock (`lockAndValidate`), *then* `PricingService` decides whether it or the first-order discount wins, and only if the coupon actually produced the discount does `CouponsService.recordRedemption` run — after the order row exists, in the same transaction. A coupon that lost to a larger first-order discount is not consumed for a benefit the buyer never received.

**Rejected — gift cards**: mentioned in the original PRD alongside coupons but a materially different feature — a stored-value balance a buyer can spend across multiple orders, not a single-order discount code. Issuance, balance tracking, and fraud on a redeemable balance are their own risk surface and deserve a dedicated design pass, not a field bolted onto `Coupon`.

**Consequence**: `discountType`/`discountValue` are immutable after a coupon is created (`CouponsService.updateCoupon` does not accept them) — changing what a shared, already-distributed code is worth would silently change a live promotion's meaning. A coupon that needs a different value is a new coupon.

## ADR-033: A failed delivery is a distinct state, not a cancellation

**Date**: 2026-08-12 · **Status**: Accepted

Delhivery reports both "moving through the network" and "attempted and could not hand over" under the same `StatusType: UD`. Because the previous mapping keyed only on `StatusType` — `UD → SHIPPED` — a failed attempt on an already-`SHIPPED` order was a **silent no-op**: nobody was told, and the stock stayed reserved indefinitely for an order nobody would complete.

**Chosen**: a new `DELIVERY_FAILED` order status, plus `SHIPPED ⇄ DELIVERY_FAILED` as the lifecycle's only legal cycle. On a failed attempt the order moves there, `deliveryAttempts` increments, and the buyer is asked over WhatsApp whether they still want it. A reply of "yes" puts the same parcel and waybill back in transit (Delhivery's NDR reattempt, not a new shipment); silence past `DELIVERY_RESPONSE_WINDOW_HOURS` cancels it.

**Rejected — marking it `CANCELLED` immediately and un-cancelling on reply.** The common case is a buyer who simply was not home. Telling them their order is cancelled and then reversing it is a worse experience than the problem it solves, and it was the explicit thing this flow existed to avoid.

**Rejected — tracking failed attempts in side columns while leaving the status `SHIPPED`.** "Awaiting the buyer's decision" is genuinely a different state from "in transit": the orders screen must render it differently, and SPEC requires the state machine to enforce legal transitions rather than have meaningful states smuggled past it.

**Rejected — branching on *why* the attempt failed.** Delhivery distinguishes "consignee not available" from "customer refused", but both get the same prompt: someone who genuinely refused simply does not reply, and the sweep closes the order for them. One flow, no reason-code mapping to get wrong.

**Consequences**:
- The window is measured from the failed attempt, not from the WhatsApp send — a provider outage delaying the message must not eat the buyer's window.
- `MAX_DELIVERY_ATTEMPTS` bounds the cycle, because couriers cap reattempts themselves; offering an unlimited "try again" would promise what Delhivery will not honour.
- The failed-attempt marker prose (`FAILED_ATTEMPT_MARKERS`) is **unverified against a live Delhivery account**. An unrecognised `UD` falls through to the ordinary in-transit path — the safe direction to be wrong in.
- Scoped to COD in practice: a prepaid order cancelled this way needs a real Cashfree refund, and no refund call exists in the codebase yet.

## ADR-034: Dispatched parcels restock on return-to-origin, not on cancellation

**Date**: 2026-08-12 · **Status**: Accepted · **Forced by**: an overselling risk found while designing ADR-033

Cancellation used to restock unconditionally. That is correct pre-dispatch, but wrong the moment a parcel is with a courier: between cancelling a failed delivery and the parcel physically arriving back at the warehouse there are days, and restocking at cancellation would let us sell units that are in a van.

**Chosen**: `performCancellation` takes an explicit `{ restockNow }` decision. Pre-dispatch cancellations (buyer cancel, COD-verification sweep) restock immediately. Post-dispatch cancellations do not; the parcel's `RT` return-to-origin webhook calls `restockReturnedParcel`, which is idempotent on a new `orders.restocked_at` column because couriers emit repeated scans and putting the same units back twice would invent inventory.

**Consequence**: restocking is no longer gated on the cancellation `changed` flag. A parcel can return days after the sweep already cancelled the order, by which point the transition is a no-op — but the goods still need putting back.

**Migration note**: existing cancelled orders are backfilled with `restocked_at = cancelled_at`, since they *were* restocked under the old behaviour. Without that they would look like they were still owed a restock.

## ADR-035: `whatsapp-bot` comes into scope for exactly one conversation

**Date**: 2026-08-12 · **Status**: Accepted · **Supersedes**: the "not built in this milestone" decision of 2026-08-10 · **MSG91-specific details superseded by ADR-036** (the one-conversation scope and matching logic described here are unchanged)

`whatsapp-bot/` was retained as empty boilerplate by explicit decision, with a note not to add it to `final_project_context.md` without approval. Answering the ADR-033 prompt required an inbound channel, and in-WhatsApp replies were chosen over an app deep link — the buyer being reached has just had a delivery go wrong, and requiring them to open and authenticate an app is friction exactly where it costs most.

**Chosen**: build the module, but scoped to this one conversation — an inbound MSG91 webhook that interprets a reply to the failed-delivery prompt and nothing else. Not a general-purpose bot.

**Design notes**:
- Reuses `WebhookIdempotencyService` (Risk #1's mechanism). MSG91 redelivers inbound messages on non-2xx, and a replayed "yes" must not book a second courier reattempt.
- Affirmative matching is generous (`yes`, `1`, `ok`, `retry`, `haan`, …) and matched on the whole trimmed message. Anything unrecognised is logged and ignored rather than guessed at — acting on an ambiguous message could book a courier the buyer never asked for.
- A "no" reply takes **no** action; the sweep closes the order at the deadline. One code path owns cancellation rather than two that could disagree.
- An inbound reply carries no order reference, so it resolves by phone to the buyer's most recent `DELIVERY_FAILED` order.
- The in-app `POST /orders/:id/request-redelivery` exists alongside it, so a buyer who opens the app instead is not stuck.

**External dependency**: WhatsApp requires business-initiated messages to use a Meta-approved template, registered through MSG91 (`MSG91_DELIVERY_RETRY_TEMPLATE`). That approval has days-to-weeks lead time, like DLT registration, and MSG91 credentials are still pending — so this flow is built and tested but not yet exercisable against a live account.

## ADR-036: Drop MSG91, call Meta's WhatsApp Business Cloud API directly

**Date**: 2026-08-17 · **Status**: Accepted · **Supersedes**: the MSG91 half of ADR-004, ADR-014's delivery channel, the MSG91 half of ADR-029, and the MSG91-specific details of ADR-035

MSG91 credentials never arrived; the business set up a Meta developer account instead and asked to drop MSG91 entirely — both OTP delivery (previously SMS via MSG91) and the WhatsApp delivery-retry channel (previously WhatsApp-via-MSG91-as-BSP) now call Meta's Graph API directly with no BSP in between.

**Chosen**: `providers/sms/` (`SmsService`) replaced wholesale by `providers/whatsapp/` (`WhatsAppService`), talking to `https://graph.facebook.com/{version}/{phone_number_id}/messages` with a bearer System User token. Two methods survive the rename 1:1 in shape: `sendOtp(phone, otp)` and `notifyTemplate(phone, templateName, bodyParams)` (renamed from `whatsappNotify`). `SmsService.verifyOtp` and the `MSG91_SENDER_ID` env var were dropped outright rather than ported — both were already dead code, since OTP verification has been self-managed via Redis since ADR-014 and `MSG91_SENDER_ID` was never read by any request.

**OTP generation/verification is unchanged** — ADR-014's Redis-HMAC design doesn't care which provider delivers the code, only that delivery happens. What changed is delivery only.

**Webhook auth changed shape, not just provider**: ADR-029's shared-secret scheme (`x-adorini-webhook-token`) covered MSG91 because MSG91 didn't sign its callbacks. Meta does — inbound WhatsApp traffic (`POST /webhooks/whatsapp`) is now authenticated by Meta's `X-Hub-Signature-256` (HMAC-SHA256 over the raw body, keyed by the app secret), verified the same way `PaymentsService` already verifies Cashfree's signature. Meta also requires a one-time `GET` verification handshake (`hub.mode`/`hub.verify_token`/`hub.challenge`) that has no MSG91 equivalent. The `/webhooks/msg91` delivery-report route is deleted outright — it was a pure audit sink with no consumer, and Meta's webhook already carries delivery-status receipts (`statuses[]`) on the same URL as inbound messages.

**`WebhookProvider.MSG91` renamed to `WebhookProvider.WHATSAPP`**, via a same-transaction `ALTER TYPE ... RENAME VALUE` migration (metadata-only, no row rewrite) rather than the more elaborate add-value/backfill/drop-type dance — safe because this is pre-launch and a rename is all Postgres needs for this case.

**Known gap, accepted deliberately**: WhatsApp is now the *only* OTP delivery channel — no SMS fallback. A phone number with no active WhatsApp account cannot receive a login code and cannot sign up. Meta's Cloud API at least fails loudly (a real error object) rather than MSG91's old silent-success-on-bad-credentials failure mode, but there is no product-level messaging yet for a buyer stuck on this path. Flagged on `WhatsAppService.sendOtp` and in `env.validation.ts`; not solved in this pass — revisit if support volume shows it is a real problem, not a hypothetical one.

**Unverified against a live account** (same caveat ADR-014 and ADR-035 already carried for MSG91, now inherited by Meta): the OTP template's button-component shape (one-tap autofill vs. copy-code vs. none) cannot be confirmed until the actual approved template exists in WhatsApp Manager — `sendOtp` currently sends a body-only send and will need its `components` array adjusted once the template is live. The inbound webhook payload shape (`entry[].changes[].value.messages[]` vs `statuses[]`) is written from Meta's published docs, not yet exercised against real traffic.

**Consequence**: every `MSG91_*` env var is gone, replaced by `WHATSAPP_*` (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_API_VERSION`, `WHATSAPP_OTP_TEMPLATE_NAME`, `WHATSAPP_DELIVERY_RETRY_TEMPLATE`, `WHATSAPP_TEMPLATE_LANGUAGE`). The delivery-retry template (`adorini_delivery_retry`) must be resubmitted fresh for Meta approval — template approval does not transfer between BSPs.
