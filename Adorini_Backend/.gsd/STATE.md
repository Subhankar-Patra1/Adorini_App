# STATE.md — Project Memory

## Current Position

- **Phase**: 2 — Data Model (PostgreSQL + TypeORM) — ✅ **COMPLETE & VERIFIED on Node 24.19.0 / PostgreSQL 18.4**
- **Next**: Phase 3 — Integration Connectors (`src/providers/`)
- **Active agent**: `@BE`
- **Blockers**: none

## Phase 2 — Verified Evidence

Verified against a live PostgreSQL 18.4 instance (Docker, `postgres:18.4`).

| Exit criterion | Proof |
| --- | --- |
| Migration runs up | `migration:run` → `InitialSchema1786403950398 has been executed successfully` — 15 tables, 19 FKs |
| Migration runs down | `migration:revert` → reverted; `pg_tables` left only `migrations`, **zero orphaned enum types** |
| Schema matches entities | `migration:generate --check` → `No changes in database schema were found` |
| Seeds load | 5 categories, 4 brands (sana/mg/mm/NAVRANGA), 5 products, 45 variants |
| Seeds are idempotent | Second `npm run seed` → identical row counts, no error (upsert on natural keys) |
| **Risk #1 duplicate webhook rejected** | Integration test: second insert of `(CASHFREE, evt_…)` → `uq_processed_webhook_provider_event` violation; row count stays 1 |
| **Risk #1 replay credits once** | 3 deliveries of one event → wallet `10000` paise, **1** ledger row (transaction rolls back on marker conflict) |
| **Risk #4 indexes exist + usable** | All 3 present in `pg_indexes`; `EXPLAIN` with `enable_seqscan=off` picks `idx_products_category_price` |
| **Risk #6 self-referral rejected** | `chk_referral_no_self_referral` violation |
| **Risk #6 phone reuse rejected** | Delete account → re-signup same phone → `uq_referral_referee_phone` violation |
| App boots with DB | `node dist/main.js` → "Nest application successfully started", TypeOrmCoreModule initialised |
| Readiness probe real | Postgres stopped → `/api/health/ready` **503** `database: down`; restored → **200** |
| Liveness independent | Postgres stopped → `/api/health` still **200** (no restart loop) |
| TypeScript strict compiles | `npx tsc --noEmit` → clean |
| Tests pass | Unit **26/26** (3 suites, no DB) · Integration **18/18** (2 suites, live PG) |
| No vulnerable deps | `npm audit` → **0 vulnerabilities** |

## Schema Delivered

15 entities in `src/database/entities/`, grouped:

- **Identity**: `User`, `Address`
- **Catalog**: `Category`, `Brand`, `Product`, `ProductVariant`, `MediaAsset`
- **Trust/PDP**: `Review`, `SizeEnquiry`
- **Commerce**: `Order`, `OrderItem`
- **Money**: `Wallet`, `WalletTransaction`, `Referral`
- **Integrity**: `ProcessedWebhook`

Supporting: `data-source.ts` (CLI), `database.module.ts` (app), `naming.strategy.ts`,
`common/enums/domain.enums.ts`, `common/schemas/size-rules.schema.ts`.

## Resolved Items

- **Environment drift** (was: STATE claimed Node 24.12.0 verified). On resuming, the machine had Node **22.23.1**, nvm-windows was gone, `node_modules` was absent and no `.env` existed. Resolved by installing Node **24.19.0** LTS (`winget OpenJS.NodeJS.LTS`, user-approved); `.nvmrc` updated 24.12.0 → 24.19.0. Phase 1 re-verified green before Phase 2 began.
- **STATE.md was stale on git** (claimed "nothing committed yet"). Phase 1 was in fact committed in `d1f8b53`; working tree was clean.
- **js-yaml advisory** (high, DoS via `@nestjs/swagger` → js-yaml ≤5.2.1). `npm audit fix` had no non-breaking path; resolved with an `overrides` pin to `js-yaml@^5.2.3`. Now 0 vulnerabilities.
- **`uuid_generate_v4()` in generated migration** — requires the `uuid-ossp` extension, which the migration never created, so it would fail on a fresh database. Set `uuidExtension: 'pgcrypto'` so TypeORM emits `gen_random_uuid()`, core in PostgreSQL 13+ and extension-free.
- **Local ports 5432/6379 occupied** by an unrelated project's containers. Adorini's Postgres/Redis bound to **5433/6380** instead; reflected in `.env`.
- **PostgreSQL 18 volume layout** — the data mount is `/var/lib/postgresql`, not `/var/lib/postgresql/data` as in ≤17. Container recreated accordingly.

## Context Notes

- **A test caught a real design flaw**: `Referral`'s user FKs were initially `ON DELETE CASCADE`, which deleted the referral row along with the account — taking the `referee_phone` claim with it and leaving the delete-and-re-signup abuse wide open despite the unique constraint. Changed to `ON DELETE SET NULL` (both user FKs now nullable) so the anti-abuse record outlives the accounts. See ADR-008.
- **Retaining `referee_phone` after account deletion is deliberate** and is a data-minimisation trade-off. **Flagged for the @ETHICS gate** — a salted hash would preserve uniqueness while holding less personal data.
- Integration tests are split from unit tests: `npm test` stays dependency-free (26 tests, no DB), `npm run test:integration` needs live Postgres (18 tests). `npm run test:all` runs both.
- Full-text search (`tsvector` + GIN) was **not** added in Phase 2 — it belongs with the catalog module in Phase 4, as a dedicated migration.
- Order state-machine *transition enforcement* is Phase 4; Phase 2 only fixes the vocabulary (`OrderStatus`) and the timestamp columns it writes.

## Local Development Setup

```bash
docker run -d --name adorini-postgres -e POSTGRES_USER=adorini \
  -e POSTGRES_PASSWORD=adorini_dev -e POSTGRES_DB=adorini \
  -v adorini-pgdata:/var/lib/postgresql -p 5433:5432 postgres:18.4
docker run -d --name adorini-redis -p 6380:6379 redis:8.6.2

npm install && npm run migration:run && npm run seed
```

Integration tests use a separate `adorini_test` database (derived from `DATABASE_URL`, or set `TEST_DATABASE_URL`).

## Next Steps

Execute Phase 3 — Integration Connectors in `src/providers/`:

1. `providers/redis/` — ioredis 5.4.x connection module (ADR-006)
2. `providers/sms/` — MSG91 REST v5 (send OTP, verify OTP)
3. `providers/payments/` — Cashfree SDK wrapper
4. `providers/logistics/` — Delhivery REST client
5. `providers/storage/` — Cloudflare R2 via `@aws-sdk/client-s3` v3
6. `providers/oauth/` — Google OAuth 2.0 verification

Each unit-tested against mocked HTTP, each failing loudly with a typed error rather than returning undefined.
Real credentials replace the `placeholder-until-phase-3` values in `.env` at this point.
