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

MSG91's npm ecosystem (`msg91`, `msg91-sdk`, `@msg91comm/otp`, `sendotp`) is a set of thin, inconsistently-maintained community wrappers with no clear official choice; Delhivery publishes no SDK. Both are called via thin internal providers over REST — equivalent effort, no unmaintained-dependency risk. Cashfree does publish an official maintained SDK (`@cashfreepayments/cashfree-sdk`), so use it.

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

## ADR-005: Backend-first build, Flutter integrates after

**Date**: 2026-08-10 · **Status**: Accepted

Deviates from the MAS pipeline's parallel `@FE + @BE`. Accepted because NestJS auto-generates OpenAPI/Swagger from controllers + DTOs, so the contract is live and testable before any client exists, and the UI design spec is already locked.

**Mitigation for the deferred-integration risk**: each module is verified against its own Swagger doc at completion — response shapes checked against the known screen requirements module-by-module, not deferred to one end-of-build integration pass.
