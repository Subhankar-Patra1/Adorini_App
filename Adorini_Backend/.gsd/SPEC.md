# SPEC.md — Adorini Backend Specification

> **Status**: `FINALIZED`
> **Scope**: Backend only (`Adorini_Backend/`). Flutter client is built after this, against the generated OpenAPI contract.
> **Source of Truth**: `AI_COWORKER/shared_memory/final_project_context.md`, `prd/PRD.md`, `architecture/ARCHITECTURE.md`, `logs/risk_report.md`

## Vision

A NestJS API serving Adorini — a discovery-and-trust-led ethnic wear commerce platform for women aged 25–55 (price band ₹300–1,500, nominal sizes 40–48). The backend owns all business truth: fabric-specific sizing rules, official-vs-buyer media provenance, COD order state transitions, and referral/wallet accounting. The Flutter client renders; it never decides.

## Goals

1. **A live, locally-testable API** — every endpoint exercisable via auto-generated Swagger UI before any Flutter code exists.
2. **Stable, documented API contracts** — OpenAPI spec generated from controllers/DTOs, so frontend work starts with zero guesswork.
3. **Validation and security at the boundary** — phone formats, PIN codes, sizes, and `size_rules` JSONB rejected at the edge, never reaching the DB malformed.
4. **Financially correct under retry and concurrency** — webhook redelivery, address-edit races, and client-supplied totals cannot cause double payouts, wrong-address shipments, or revenue leakage.

## Non-Goals (Out of Scope)

- Flutter/mobile UI implementation (separate milestone, follows this one).
- Go microservice extraction — deferred until p99 search latency or webhook volume metrics require it.
- AWS services of any kind (see DECISIONS.md ADR-003).
- Referral fraud heuristics beyond basic DB constraints (device/IP fingerprinting is post-MVP).

## Users

- **Buyers** (via Flutter app) — browse, size-check, order COD/UPI/Card, track, return, refer.
- **Admins** (via admin module endpoints) — product/variant CRUD, `size_rules` authoring, order overrides, return review, custom-size enquiry inbox.
- **External systems** — Cashfree, Delhivery, MSG91 calling in via webhooks.

## Constraints

- **Runtime**: Node.js 24.x LTS, NestJS v11.1.28, TypeORM 1.1.0, PostgreSQL 18.4, Redis 8.6.2 (ioredis 6.0.0), Zod v4. No pre-GA versions (NestJS v12, PG 19) until stable.
- **Infra**: Two vendors only — Railway (compute/DB) + Cloudflare (R2 storage, edge/CDN/WAF).
- **Integrations**: Cashfree via official SDK; MSG91 and Delhivery via direct REST through thin internal providers (no unmaintained npm wrappers).
- **Build order**: Backend complete and documented before Flutter integration begins. Each module verified against its own Swagger doc at completion — not deferred to a single end-of-build integration pass.

## Success Criteria

- [ ] `npm run start:dev` boots clean; Swagger UI reachable and lists every module's endpoints.
- [ ] All 5 `risk_report.md` mitigations implemented with passing tests that fail if the mitigation is removed.
- [ ] Every endpoint rejects malformed input with a structured error before touching the database.
- [ ] Seed data loads: garment categories, brands (sana, mg, mm, NAVRANGA), stretch/rigid fit dimensions.
- [ ] Order state machine enforces legal transitions only; illegal transitions rejected, not silently ignored.
- [ ] Webhook redelivery of the same event ID produces exactly one wallet credit / one status transition.
