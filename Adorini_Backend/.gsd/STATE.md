# STATE.md — Project Memory

## Current Position

- **Phase**: 4 — Feature Modules — 🔄 **IN PROGRESS**. `auth` and `users` ✅ complete & verified.
- **Next**: `catalog` → `pdp` → `cart` → `checkout` → `orders` → `webhooks` → `wallet` → rest
- **Active agent**: `@BE`
- **Blockers**: none. Credentials still outstanding; they do not block further Phase 4 work.

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
