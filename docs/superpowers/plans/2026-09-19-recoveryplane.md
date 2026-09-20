# RecoveryPlane Implementation Plan

> Use test-driven development for the recovery domain and independent review before delivery. User delegated implementation decisions and requested a working product.

**Goal:** Ship a runnable, documented recovery product with real persistence and signed origin execution.
**Spec:** docs/PRODUCT.md
**Stack:** TypeScript, Express, React/Vite, Zod, PostgreSQL/PGlite, Node test runner.

## Global constraints

- Preserve all recovery invariants in docs/PRODUCT.md.
- Local data is persistent and ignored by Git; credentials never appear in read APIs.
- No fake outcomes or fabricated metrics. Demo data is clearly labeled.
- Node 22 or newer, pnpm 9.1.0. Works on Windows and Linux.

## Tasks

- [x] 1. Database and recovery domain: `packages/database/src/*`, `apps/api/src/domain/*`, `tests/domain.test.ts`. Write failing tests for report identity, tenant isolation, command concurrency, result deduplication and current revocation; implement transactional SQL repository and domain service. Run `pnpm test`.
- [x] 2. API and delivery: `apps/api/src/server.ts`, `apps/worker/src/*`, `packages/sdk/src/*`, `tests/http.test.ts`. Verify roles and signed payloads, claim with expiring lease tokens, redeliver same identity, persist outcomes atomically. Test real local HTTP, uncertain response and revocation before dispatch.
- [x] 3. Operator console: `apps/web/src/*`. Implement against documented HTTP contract in `docs/HTTP-CONTRACT.md`; use real APIs, handle loading/errors/conflicts, accessibility and responsive layouts. Verify production build and browser patch-then-retry journey.
- [x] 4. Onboarding and release: seed a durable demo origin; add start scripts, env example, Compose, CI, README and integration examples. Verify a clean startup, persistent restart, build and all tests. Remove obsolete scaffolding and generated logs only inside workspace.
- [x] 5. Independent review: inspect authorization, recovery semantics, retry crashes, origin idempotency, UI error behavior; fix actionable findings, rerun relevant tests and deliver concrete run instructions.

## Review focus

- Same fingerprint with different entity: distinct cases.
- Lost response after mutation: same command, no duplicate mutation.
- Invalid/expired signature: no state changes.
- Disabled action on historical case: no new dispatch.
- Browser conflict/failed request: visible message and data refresh.
