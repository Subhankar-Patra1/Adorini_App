# STATE.md — Project Memory

## Current Position

- **Phase**: 4 — Feature Modules — ✅ **COMMERCE COMPLETE**
  - ✅ `auth`, `users`, `cart`, `checkout`, `orders`, `wallet`, `admin`, `returns`
  - ✅ `catalog`, `pdp`, `webhooks` (parallel workstream, reviewed and integrated)
  - ⬜ Deferred: `videos`, `jobs`, `whatsapp-bot` (see below)
- **Next**: live credential smoke test, then the gates (`@SEC` → `@ETHICS` → `@QA`)
- **Active agent**: `@BE`
- **Blockers**: none.

**Current totals**: **491 unit tests** (36 suites) · **124 integration tests** (8 suites) · **56 routes** ·
tsc clean · lint clean · 0 vulnerabilities · no schema drift.

A buyer can now: sign up → browse → view a product → add to cart → check out (COD or prepaid) →
verify COD by OTP → track the order → change the delivery address before dispatch → cancel → request a
return. Staff can manage the catalogue and the enquiry inbox.

---

## Phase 4 — Commerce Modules (2026-08-12)

### @GUARD mitigations — all five now implemented and test-proven

| Risk | Where | Proof |
| --- | --- | --- |
| **#1 CRITICAL** webhook idempotency | `webhooks` | Marker row + side effects in one transaction; replay credits once |
| **#2 HIGH** address-edit race | `orders` | Status re-read under `FOR UPDATE` immediately before write; a dispatched order returns `ADDRESS_LOCKED` and the stored address is unchanged |
| **#3 HIGH** server-authoritative pricing | `cart`/`checkout` | The place DTO has **no price field**; an integration test posts `totalPaise: 1` and the order still costs the correct amount |
| **#4 MEDIUM** catalog indexes | `catalog` | Present since Phase 2; planner verified |
| **#5 MEDIUM** `size_rules` validation | `admin` | Malformed charts rejected on write; a chart contradicting the product's fabric is refused |

### Modules delivered

- **`cart`** — new `cart_items` table. Stores no prices (ADR-022); every read is live. Repeat adds merge,
  size/colour changes re-point the line and merge on collision.
- **`checkout`** — `PricingService` shared with the cart so quote and charge cannot diverge (ADR-023).
  Locks variants in id order, decrements conditionally (ADR-024), writes order + lines + wallet debit and
  empties the cart in one transaction. COD routes through an intent OTP reusing the auth module's
  `OtpService`, namespaced per order so a login code cannot confirm an order.
- **`orders`** — history, detail, pre-dispatch address edit (Risk #2), cancellation that restocks and
  refunds store credit in the same transaction.
- **`wallet`** — balance (spendable *and* pending referral credit, shown separately) and the statement.
- **`admin`** — product/variant CRUD, enquiry inbox, `AdminGuard` reading `is_admin` per request (ADR-027).
- **`returns`** — new `return_requests` table. Per order line, 3-day window from delivery, sizing reasons
  auto-derive their fit tag (ADR-026).

### Bug found and fixed during this work

**The exception filter was discarding every service-supplied error code** (ADR-025). Modules raise
`ADDRESS_LOCKED`, `INSUFFICIENT_STOCK`, `OTP_COOLDOWN` and so on precisely so a client can branch on
them; the filter overwrote each with the generic status name. Nothing failed — the API returned correct
statuses and quietly threw away its entire machine-readable vocabulary. Caught only because the commerce
journey test asserted the code rather than the status.

### Deliberately not built

- **`videos`** — the reels feed is a content feature, not part of the purchase path.
- **`jobs`** — scheduling is blocked on an open business decision (referral-claim expiry; see below).
  `TokenService.purgeExpiredBefore()` and a referral sweep are the two jobs waiting for it.
- **`whatsapp-bot`** — boilerplate only, by earlier decision.
- **Refunds** — returns record and approve, but move no money (ADR-026).

### Open business questions

1. **`DELIVERY_FEE_PAISE` defaults to ₹49 and is a placeholder.** The PRD fixes the free-delivery
   *threshold* (₹3,000) but never states the fee. Every buyer under the threshold is charged it.
2. **Referral-claim expiry** — a `PENDING` referral currently never expires, so it is both an open
   liability and a permanent block on that phone being referred again. Raised with the user; deferred.

---

## Cross-Workstream Integration Review (2026-08-12)

`catalog`, `pdp`, `webhooks`, `orders` and `wallet` were built in parallel with `auth`/`users`. Reviewing
them together surfaced five defects, all in the seams between the two workstreams rather than inside
either one. The parallel modules themselves are well built — idempotent webhook ingestion, pessimistic
locking on the money path, cursor pagination, careful 2xx-on-duplicate handling.

| # | Defect | Impact | Fix |
| --- | --- | --- | --- |
| 1 | **No `@Public()` on catalog/pdp/webhooks** | **The entire storefront returned 401**, and all three provider webhooks were rejected before their own auth ran — payments unconfirmed, referrals unpaid | `@Public()` added; regression spec now asserts the public surface (ADR-016) |
| 2 | **Referral payout could never fire** | `qualifyingOrderId` is read but never written; every payout silently found nothing | Fallback resolves the referee's `PENDING` referral via the order (ADR-018) |
| 3 | **`ZodError` → 500 on webhooks** | A 5xx tells providers to redeliver, so an unparseable payload would retry forever | Mapped to 400 (ADR-019) |
| 4 | **`search_vector` unmapped** | `migration:generate` emitted `DROP COLUMN "search_vector"`; drift check permanently red | Mapped read-only (ADR-020) |
| 5 | **`AddProductSearchVector` never applied locally** | Catalog search would 500 | Migration run; verified backfilled and matching |

Two smaller ones: the size-enquiry DTO reimplemented phone normalisation with rules that diverged from
`phone.util` (`09876543210` passed through unnormalised, so one buyer could appear twice in the admin
inbox) — now uses the shared schema; and size enquiries hardcoded `userId: null`, so a signed-in buyer's
enquiry lost its attribution — now populated via `@OptionalUser()` (ADR-017).

**Checked and found correct**: webhook idempotency (marker inserted in the same transaction as the side
effects, Redis failing open), duplicate-detection via `driverError.code` (verified `23505` is present on
both `error.code` and `error.driverError.code` against the live driver), `rawBody: true` for Cashfree
signature verification, and the MSG91 payload schema's `refine` that guarantees a de-duplication key.

---

## Phase 4 — `auth` + `users` (2026-08-12)

### Verified evidence

| Check | Result |
| --- | --- |
| Unit tests | ✅ **264/264**, 20 suites, no DB or network |
| Integration tests | ✅ **70/70**, 5 suites, live PostgreSQL + Redis via supertest |
| TypeScript strict | ✅ `tsc --noEmit` clean |
| Lint | ✅ `npm run lint` clean (the @BE "no `any`" rules are errors) |
| Dependency audit | ✅ 0 vulnerabilities |
| Migration | ✅ `AddRefreshTokens` applies, reverts, re-applies; drift check "No changes" |
| App boots | ✅ **19 routes** mapped; Swagger lists `auth`, `users`, `health` |
| **Fail-closed auth** | ✅ `/api/users/me` without a token → **401**; health probes still **200** |
| **Redis outage** | ✅ Redis stopped → OTP request **503 `CACHE_UNAVAILABLE`** (not 500); liveness stayed 200; recovered to 202 |
| Swagger contract | ✅ bearer scheme present; `/auth/google` documented as a 2-branch `oneOf` |
| Phases 1–3 not regressed | ✅ all previous suites still pass |

### Endpoints delivered

**auth** — `otp/request` (202), `otp/verify` (200, the only user-creating path), `google` (200 discriminated),
`google/link` (bearer), `refresh`, `logout`, `logout-all` (bearer).

**users** — `GET/PATCH /users/me`, `GET /users/me/referral-code`, `GET /users/me/referrals`,
and full address CRUD incl. `POST /users/me/addresses/:id/default`.

### Shared foundations now available to every later module

`JwtAuthGuard` (global, fail-closed) · `@Public()` · `@CurrentUser()` · `AllExceptionsFilter` ·
`normalisePhone`/`phoneSchema` · `durationToSeconds` · `fetchWithTimeout` (Phase 3) ·
`src/common/testing/http-body.ts` for typed supertest bodies.

**Every later controller must remember `@Public()` on genuinely public routes** (catalog, PDP, search) —
see ADR-013 for why the guard is opt-out rather than opt-in.

### Decisions recorded

ADR-012 (Google starts signup, OTP completes it) · ADR-013 (fail-closed guard; access token carries only
`sub`) · ADR-014 (self-managed OTP; attempt cap is the real control) · ADR-015 (referral capture outside
the signup transaction).

### Bugs caught during this phase

- **`z.date()` crashes Swagger generation at bootstrap** — "Date cannot be represented in JSON Schema".
  Caught by booting the app before writing tests. Response timestamps are documented as
  `z.iso.datetime()`, which is also what the client actually receives over JSON.
- **`POST /addresses/:id/default` returned 201** — Nest defaults POST to 201, but nothing is created.
  Corrected to 200 with `@HttpCode`.
- **MSG91 reports success for invalid credentials** (see ADR-014) — a live-fire finding, not a code bug.

### Rules for every module built from here

1. **Public routes need `@Public()` and an entry in `public-routes.integration.spec.ts`.** Auth is
   fail-closed; forgetting it is a 401, and the spec is what catches it (ADR-016).
2. **`checkout` must set `Referral.qualifyingOrderId`** on the referee's first order. There is now a
   fallback so payouts work without it (ADR-018), but the explicit link is still the authoritative one.
3. **Parse request bodies through DTOs where possible.** Hand-parsed schemas now map to 400 rather than
   500 (ADR-019), but the pipe is still the better path.
4. **Never map a trigger-maintained column as writable** — and never leave it unmapped either (ADR-020).

### Deliberately not built

- **Admin/roles guard** — deferred to the `admin` module (user decision). `users.isAdmin` exists and is
  excluded from every buyer-facing payload.
- **Referral qualification and payout** — `auth` only records a `PENDING` row; crediting on `DELIVERED`
  belongs to `wallet`/`webhooks` with the @GUARD Risk #1 transaction.
- **Refresh-token cleanup scheduling** — `TokenService.purgeExpiredBefore()` exists; the `jobs` module
  will schedule it.
- **Phone-number change flow** — `PATCH /users/me` deliberately cannot change `phone`; it needs OTP
  verification of the new number.

---

## Earlier phases (all verified)

- **Phase 1 — Engine**: NestJS 11 on Node 24.19.0, strict TS, Zod-validated env, Swagger, health probe.
- **Phase 2 — Data Model**: 16 entities (15 + `RefreshToken`), reversible migrations, idempotent seeds.
  @GUARD Risks #1 (webhook idempotency), #4 (catalog indexes), #6 (referral abuse) enforced as database
  constraints and proven by test.
- **Phase 3 — Providers**: 6 isolated connectors (redis, sms, payments, logistics, storage, oauth), each
  with a typed error and an enforced deadline. Six real bugs fixed during audit — see git history and
  ADR-010/011.

---

## Credentials

`.env` still holds `placeholder-until-phase-3` values. Providers and auth are tested against stubs, so
this blocks **live smoke-testing only**.

Start the slow ones now: **MSG91** needs Indian DLT registration (days–weeks); **Delhivery** needs a
business account (days). Cashfree sandbox, Cloudflare R2 and Google OAuth are self-serve in minutes.

**At smoke-test time, verify:**
1. An SMS actually **arrives** — MSG91 returns `type: success` for invalid credentials (ADR-014), so the
   response proves nothing.
2. The MSG91 v5 OTP path (`/api/v5/otp`) — still flagged unverified in `sms.service.ts`.
3. Google ID tokens from the **Android/iOS** client IDs are accepted — set
   `GOOGLE_OAUTH_MOBILE_CLIENT_IDS`, or mobile login fails audience validation.

---

## Local Development Setup

```bash
docker run -d --name adorini-postgres -e POSTGRES_USER=adorini \
  -e POSTGRES_PASSWORD=adorini_dev -e POSTGRES_DB=adorini \
  -v adorini-pgdata:/var/lib/postgresql -p 5433:5432 postgres:18.4
docker run -d --name adorini-redis -p 6380:6379 redis:8.6.2

npm install && npm run migration:run && npm run seed
npm test                  # 264 unit tests, no DB or network
npm run test:integration  # 70 tests, needs live PostgreSQL + Redis
npm run lint              # clean
```

Ports are 5433/6380 — the defaults were taken by an unrelated project.
Integration tests use a separate `adorini_test` database and run migrations themselves.

---

## Next Steps

`catalog` is next: garment tabs, print/technique chips, price/size/brand filters, full-text search,
"Shop by brand" rail, infinite scroll.

Notes for it:
- Catalog browsing is **public** — every route needs `@Public()` (ADR-013).
- The @GUARD Risk #4 indexes (`idx_products_category_price`, `idx_products_brand`,
  `idx_products_fabric_type`) already exist; queries must be shaped to use them.
- Full-text search (`tsvector` + GIN) was deferred from Phase 2 and belongs here as its own migration.
- Watch for N+1 on `leftJoinAndSelect` for media/variants (ADR-001 consequence).

Remaining @GUARD mitigations land in later modules: Risk #2 (address-edit race, `orders`), Risk #3
(server-authoritative pricing, `checkout`), Risk #5 (`size_rules` validation, `admin`), Risk #1
(webhook/wallet single transaction, `webhooks`/`wallet`).
