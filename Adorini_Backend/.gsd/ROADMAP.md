# ROADMAP.md — Adorini Backend

> **Current Phase**: 4 (Phases 1–3 complete & verified; Phase 4 in progress — `auth` + `users` done)
> **Milestone**: Backend v1.0 (API-complete, pre-Flutter)
> **Gate status**: @GUARD passed (`approval_status: true`) with 5 mitigations mandated below.

## Must-Haves (from SPEC)

- [ ] Live Swagger-documented API, every module exercisable without a client
- [ ] All @GUARD mitigations implemented and test-proven
- [ ] Boundary validation (Zod v4) on every input
- [ ] Order state machine with illegal-transition rejection
- [ ] Idempotent webhook ingestion

## Phases

### Phase 1: Engine — Workspace & Environment

**Status**: ✅ Complete (verified — see STATE.md evidence table)
**Objective**: A booting NestJS 11 app on Node 24.12.0 with strict TypeScript, validated env config, and Swagger wired up. Nothing domain-specific yet.
**Delivers**: `package.json`, `tsconfig` (strict), `main.ts`, `app.module.ts`, Zod-validated `ConfigModule`, Swagger bootstrap, ESLint/Prettier, health endpoint.
**Exit criteria**: `npm run start:dev` boots; `/health` returns 200; `/docs` renders Swagger UI; app refuses to boot on missing/invalid env var.

### Phase 2: Data Model — PostgreSQL + TypeORM

**Status**: ✅ Complete (verified — see STATE.md evidence table)
**Objective**: The single source of truth — entities, relations, migrations, and realistic seed data.
**Delivered**: 15 entities (the 10 specified plus `Address`, `Category`, `Brand`, `WalletTransaction`, `Referral` — `Category`/`Brand` are required by the mandated seeds, `Referral` by Risk #6, `WalletTransaction` as the append-only ledger behind the wallet balance), TypeORM datasource + `InitialSchema` migration, idempotent seeds (5 categories, 4 brands, 5 products, 45 variants) with fabric-derived stretch/rigid size charts.
**Carries @GUARD mitigations**:

- **Risk #1 (CRITICAL)** — `processed_webhooks` table with a UNIQUE constraint on `(webhook_provider, webhook_event_id)`. The constraint is the guarantee; Redis is only a fast-path pre-check.
- **Risk #4 (MEDIUM)** — composite indexes on `(category_id, price)`, `(brand_id)`, `(fabric_type)` for the filter rail.
- **Risk #6 (LOW)** — DB-level `referrer_id != referee_id` check + one-referral-per-phone uniqueness. ✅ Both present. Required changing the user FKs to `ON DELETE SET NULL`: under `CASCADE` the referral row died with the account and the phone claim went with it, so the uniqueness constraint did not actually close the delete-and-re-signup path (ADR-008).
**Exit criteria**: ✅ All met — migrations run clean up and down (no orphaned enum types); seeds load and are idempotent; duplicate `(provider, event_id)` raises a constraint violation, proven by integration test.

**Additional integrity constraints added beyond the mandate** (all test-proven): order totals must equal their own components and be non-negative (backstop for Risk #3), order line total must equal unit price × quantity, wallet balance and variant stock cannot go negative, wallet ledger sign must match transaction type, buyer media must have an uploader (protects the Official Media badge), nominal size confined to 40–48, PIN code format.

### Phase 3: Integration Connectors — `src/providers/`

**Status**: ✅ Complete (verified — see STATE.md evidence table)
**Objective**: Isolated, unit-testable wrappers for external services. No business logic lives here.
**Delivers**:

- `providers/sms/` — MSG91 REST v5 client (send OTP, verify OTP, WhatsApp notify)
- `providers/payments/` — Cashfree SDK wrapper (create payment session, reconcile txn state)
- `providers/logistics/` — Delhivery REST client (register shipment, fetch tracking)
- `providers/storage/` — Cloudflare R2 via `@aws-sdk/client-s3` v3 (upload, presign, retrieve)
- `providers/redis/` — ioredis 5.4.x connection module (see ADR-006)
- `providers/oauth/` — Google OAuth 2.0 verification
**Exit criteria**: Each provider unit-tested against mocked HTTP; each fails loudly (typed error) on upstream failure rather than returning undefined.

**Audit + completion (2026-08-12)**: all gaps closed.

- [x] All 6 providers have typed error classes with tested failure paths (was 5/6 — `redis` had none).
- [x] Every outbound call carries a deadline — `fetchWithTimeout` / `AbortSignal.timeout()`, R2 via `NodeHttpHandler` (ADR-011).
- [x] `axios` clarified: **not** an unused dependency but an npm override lifting `cashfree-pg`'s exact `1.15.0` pin (ADR-010). Retained and documented.
- [x] Lint clean; all `Promise<any>` returns replaced with real interfaces.
- [x] DI wiring proven — `providers.wiring.integration.spec.ts` compiles all 6 modules under the real `ConfigModule`.

**Six real bugs fixed** (detail in STATE.md): `verifyOtp` threw on a wrong OTP instead of returning false; WhatsApp used the SMS sender ID as the phone number; webhook signatures compared with timing-unsafe `===`; paise→rupee float conversion; Google `aud` check skipped when the claim was absent; Delhivery `success: false` inside HTTP 200 treated as success.

**Tests**: 114 unit (mocked HTTP, no network) + 25 integration. `tsc` clean, lint clean, 0 vulnerabilities.

**Deferred to the credential smoke test**: MSG91 v5 OTP endpoint paths are unverified against a live account and are flagged with a `NOTE` in `sms.service.ts`.

### Phase 4: Feature Modules — `src/modules/`

**Status**: ✅ Commerce complete — `auth`, `users`, `catalog`, `pdp`, `cart`, `checkout`, `orders`, `wallet`, `webhooks`, `admin`, `returns` all built and verified. `videos` / `jobs` deferred (see STATE.md). **All five @GUARD mitigations implemented and test-proven.**
**Objective**: Domain logic, module by module. Each module = controller + DTOs (Zod) + service, verified via Swagger before moving on.
**Build order** (dependency-driven):

1. ✅ `auth` — phone OTP request/verify, Google two-step signup (ADR-012), rotating JWTs with reuse detection, referral capture. Plus the shared foundations every later module inherits: global fail-closed `JwtAuthGuard` (ADR-013), `@Public()`, `@CurrentUser()`, and the global exception filter.
2. ✅ `users` — profile, referral code/list, address CRUD with default-address exclusivity and 404-not-403 ownership scoping
3. `catalog` — search, filters (price/size/brand/print), infinite scroll pagination ← **next**. Browsing is public: every route needs `@Public()`. Full-text search (`tsvector` + GIN), deferred from Phase 2, belongs here.
4. `pdp` — media gallery w/ `ADMIN`|`BUYER` provenance, dynamic fabric size chart, reviews + fit tags, custom-size enquiry
5. `cart` — inline qty/size/colour edit, Redis session + Postgres sync
6. `checkout` — address validation, Cashfree session, COD OTP verification
7. `orders` — state machine, Delhivery tracking sync
8. `webhooks` — idempotent Cashfree/Delhivery/MSG91 ingestion
9. `wallet` — referral credit on `Delivered`, balance, coupons
10. `returns`, `videos`, `admin`, `jobs`

~~**Not built in this milestone**: `whatsapp-bot/` — directory structure is retained as boilerplate only. No controllers, services, or logic to be written (user decision, 2026-08-10). It is deliberately absent from `final_project_context.md`; do not add it there without explicit approval.~~

**Superseded 2026-08-12 (ADR-035).** `whatsapp-bot` is now built, with approval, scoped to **one conversation only**: interpreting a buyer's reply to the failed-delivery prompt (ADR-033). Chosen over an app deep link because the buyer being reached has just had a delivery go wrong, and requiring them to open and authenticate an app adds friction exactly where it costs most. It is **not** a general-purpose bot, and it is now recorded in `final_project_context.md` accordingly. Any expansion beyond this one flow is a fresh scope decision.

**Carries @GUARD mitigations**:

- **Risk #1 (CRITICAL)** — in `webhooks`/`wallet`: the wallet credit and the `processed_webhooks` insert occur in **one DB transaction**. Test must prove a replayed event ID credits exactly once.
- **Risk #2 (HIGH)** — in `orders`: address-edit re-checks order status inside the transaction (`SELECT ... FOR UPDATE`) immediately before write. Test must prove a concurrent `Shipped` transition blocks the edit.
- **Risk #3 (HIGH)** — in `checkout`: free-delivery threshold, first-order discount, and referral credit recomputed server-side at placement. Client-supplied totals ignored entirely. Test must prove a tampered total is rejected.
- **Risk #5 (MEDIUM)** — in `admin`: `size_rules` JSONB validated against a Zod schema on write; malformed rules rejected, never persisted.
**Exit criteria**: Every endpoint in Swagger, exercisable; all mitigation tests pass and fail if the mitigation is deleted.

## After This Milestone

Flutter client build, integrating against the OpenAPI contract produced here.
