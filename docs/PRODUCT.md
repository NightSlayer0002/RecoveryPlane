# RecoveryPlane release brief

RecoveryPlane gives operations teams one place to investigate, assign, and recover blocked business operations. The originating service executes each action and confirms the outcome. This release must be runnable from a fresh clone and demonstrate a real recovery loop, not mocked buttons.

## Release scope

- A responsive operations console: searchable/filterable inbox, case details, ownership, priority, notes, registered action forms, confirmation, delivery history, and audit timeline.
- Integration settings: create integrations, one-time machine credentials, immutable action versions, enable/disable controls. Role checks on every mutation.
- Vendor onboarding demo over signed HTTP: missing country, patch country (case stays open), retry verification (origin confirms recovery). Durable origin receipts prevent duplicate mutations.
- Persistent PostgreSQL storage. Local quick start uses embedded PostgreSQL (PGlite); deployment uses a PostgreSQL server through the same SQL repository.
- Durable command outbox with leases, bounded HTTP delivery, stable command identity on retries, unknown outcomes and manual reconciliation. Database polling replaces the scaffold's nonfunctional Redis transport; adding a queue later must not change correctness.
- Explicit local demo sessions with admin/operator/viewer roles; production uses configured hashed access tokens mapped to organization and role. This release is a self-hosted pilot, not a public multi-user SaaS identity service.
- SDK, HTTP integration example, reproducible setup, CI, Docker deployment, security and operational limitations documented.

## Invariants

Idempotency hashes the complete validated report. Correlation joins only the same unresolved problem within an integration; fingerprint is similarity only. One active command per case. Cases, commands, audit and outbox writes are atomic. Current revocation overrides historical actions. Acknowledgement never proves success. Unknown outcomes remain active and redeliver the same command. Only origin-confirmed recovery counts as recovered. Cancellation and dismissal are separate. Tenant identity comes from credentials. Actions requiring independent approval are rejected.

## Architecture decisions

Retain TypeScript, React/Vite, Zod and the monorepo. Replace incomplete Nest/Prisma scaffolding with a small Express API and explicit SQL transactions: fewer moving parts, and exactly the same constraints in local and hosted modes. No Redis is necessary for correctness. Run API and dispatcher together locally; allow a separate dispatcher against server PostgreSQL. PGlite is single-process only. Callback destinations are pinned to approved DNS addresses; only explicitly configured demo loopback endpoints may use HTTP. SSE invalidations are backed by periodic refetch.

## Verification

Integration tests use an actual embedded PostgreSQL engine and signed HTTP origin, plus CI against server PostgreSQL. Cover duplicate and conflicting reports/results, correlation, cross-tenant access, role boundaries, simultaneous actions, revoked queued actions, uncertain delivery and replay, patch versus recovery, and persistence. Run typechecks, production build and browser walkthrough. Document any deployment checks not run locally.
