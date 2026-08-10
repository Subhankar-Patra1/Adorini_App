# ROADMAP.md — Adorini Backend

> **Current Phase**: 2 (Phase 1 complete & verified)
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

**Status**: ⬜ Not Started
**Objective**: The single source of truth — entities, relations, migrations, and realistic seed data.
**Delivers**: Entities (`User`, `Product`, `ProductVariant`, `MediaAsset`, `Order`, `OrderItem`, `Review`, `SizeEnquiry`, `Wallet`, `ProcessedWebhook`), TypeORM datasource + migrations, seeds (garment categories, brands `sana`/`mg`/`mm`/`NAVRANGA`, stretch/rigid fit dimensions).
**Carries @GUARD mitigations**:

- **Risk #1 (CRITICAL)** — `processed_webhooks` table with a UNIQUE constraint on `(webhook_provider, webhook_event_id)`. The constraint is the guarantee; Redis is only a fast-path pre-check.
- **Risk #4 (MEDIUM)** — composite indexes on `(category_id, price)`, `(brand_id)`, `(fabric_type)` for the filter rail.
- **Risk #6 (LOW)** — DB-level `referrer_id != referee_id` check + one-referral-per-phone uniqueness.
**Exit criteria**: Migrations run clean up and down; seeds load; inserting a duplicate `(provider, event_id)` raises a constraint violation (proven by test).

### Phase 3: Integration Connectors — `src/providers/`

**Status**: ⬜ Not Started
**Objective**: Isolated, unit-testable wrappers for external services. No business logic lives here.
**Delivers**:

- `providers/sms/` — MSG91 REST v5 client (send OTP, verify OTP, WhatsApp notify)
- `providers/payments/` — Cashfree SDK wrapper (create payment session, reconcile txn state)
- `providers/logistics/` — Delhivery REST client (register shipment, fetch tracking)
- `providers/storage/` — Cloudflare R2 via `@aws-sdk/client-s3` v3 (upload, presign, retrieve)
- `providers/redis/` — ioredis 5.4.x connection module (see ADR-006)
- `providers/oauth/` — Google OAuth 2.0 verification
**Exit criteria**: Each provider unit-tested against mocked HTTP; each fails loudly (typed error) on upstream failure rather than returning undefined.

### Phase 4: Feature Modules — `src/modules/`

**Status**: ⬜ Not Started
**Objective**: Domain logic, module by module. Each module = controller + DTOs (Zod) + service, verified via Swagger before moving on.
**Build order** (dependency-driven):

1. `auth` — phone OTP request/verify, Google OAuth, JWT issue/refresh
2. `users` — profile, address CRUD *(note: directory missing from scaffold — create it)*
3. `catalog` — search, filters (price/size/brand/print), infinite scroll pagination
4. `pdp` — media gallery w/ `ADMIN`|`BUYER` provenance, dynamic fabric size chart, reviews + fit tags, custom-size enquiry
5. `cart` — inline qty/size/colour edit, Redis session + Postgres sync
6. `checkout` — address validation, Cashfree session, COD OTP verification
7. `orders` — state machine, Delhivery tracking sync
8. `webhooks` — idempotent Cashfree/Delhivery/MSG91 ingestion
9. `wallet` — referral credit on `Delivered`, balance, coupons
10. `returns`, `videos`, `admin`, `jobs`

**Not built in this milestone**: `whatsapp-bot/` — directory structure is retained as boilerplate only. No controllers, services, or logic to be written (user decision, 2026-08-10). It is deliberately absent from `final_project_context.md`; do not add it there without explicit approval.

**Carries @GUARD mitigations**:

- **Risk #1 (CRITICAL)** — in `webhooks`/`wallet`: the wallet credit and the `processed_webhooks` insert occur in **one DB transaction**. Test must prove a replayed event ID credits exactly once.
- **Risk #2 (HIGH)** — in `orders`: address-edit re-checks order status inside the transaction (`SELECT ... FOR UPDATE`) immediately before write. Test must prove a concurrent `Shipped` transition blocks the edit.
- **Risk #3 (HIGH)** — in `checkout`: free-delivery threshold, first-order discount, and referral credit recomputed server-side at placement. Client-supplied totals ignored entirely. Test must prove a tampered total is rejected.
- **Risk #5 (MEDIUM)** — in `admin`: `size_rules` JSONB validated against a Zod schema on write; malformed rules rejected, never persisted.
**Exit criteria**: Every endpoint in Swagger, exercisable; all mitigation tests pass and fail if the mitigation is deleted.

## After This Milestone

Flutter client build, integrating against the OpenAPI contract produced here.
