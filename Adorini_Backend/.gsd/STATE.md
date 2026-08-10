# STATE.md — Project Memory

## Current Position

- **Phase**: 1 — Engine (Workspace & Environment) — ✅ **COMPLETE & VERIFIED on Node 24.12.0**
- **Next**: Phase 2 — Data Model (PostgreSQL + TypeORM entities, migrations, seeds)
- **Active agent**: `@BE`
- **Blockers**: none

## Phase 1 — Verified Evidence

All re-verified on Node 24.12.0 / npm 11.6.2 after a clean `node_modules` reinstall.

| Exit criterion | Proof |
| --- | --- |
| App boots | `node dist/main.js` → "Nest application successfully started" |
| Health endpoint | `GET /api/health` → `200` `{"status":"ok","timestamp":"..."}` |
| Swagger UI renders | `GET /docs` → `200` |
| OpenAPI contract generated | `GET /docs-json` → valid OpenAPI `3.0.0` document |
| Refuses boot on bad config | `JWT_SECRET=tooshort DATABASE_URL=not-a-url` → aborts, naming **both** failures |
| TypeScript strict compiles | `npx tsc --noEmit` → clean |
| Tests pass | `npx jest` → **18/18 passing**, 2 suites |
| Engine matches spec | `npm install` → no `EBADENGINE` warning |

## Resolved Items

- **Node runtime** (was: local v20.20.0 vs spec 24.x LTS). Node **24.12.0** was already installed under nvm-windows 1.2.2 but inactive. Switched via `nvm use 24.12.0`; `node_modules` deleted and reinstalled clean against the Node 24 ABI; full Phase 1 verification re-run and passing. Version pinned in `.nvmrc` (`24.12.0`) alongside the existing `engines.node >=24.0.0` in `package.json`.
- **`src/modules/users/`** (was: missing from scaffold). Created with the same layout as sibling modules — `controllers/`, `services/`, `dto/`, each with a `.gitkeep`.
- **`src/modules/whatsapp-bot/`** (was: present in scaffold, absent from approved docs). User decision (2026-08-10): **retain the directory as boilerplate only, write no logic.** Removed from the Phase 4 build list in ROADMAP.md and explicitly marked not-in-milestone. Deliberately *not* added to `final_project_context.md` — doing so requires explicit approval per the shared-memory update rule.

## Context Notes

- Two ADRs were forced by empirical failure during Phase 1, not chosen up front — see ADR-006 (ioredis 5 vs 6) and ADR-007 (Zod via `nestjs-zod`). Both are reflected back into `shared_memory/final_project_context.md`.
- Nothing has been committed to git yet; Phase 1 exists as untracked working-tree changes.

## Next Steps

Execute Phase 2 — entities, migrations, seeds. Must carry:

1. `processed_webhooks` UNIQUE constraint on `(webhook_provider, webhook_event_id)` — @GUARD Risk #1 (CRITICAL)
2. Composite indexes on `(category_id, price)`, `(brand_id)`, `(fabric_type)` — @GUARD Risk #4
3. `referrer_id != referee_id` + one-referral-per-phone constraints — @GUARD Risk #6
