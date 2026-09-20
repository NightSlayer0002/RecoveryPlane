# Architectural decisions

1. RecoveryPlane owns exception state; origin systems own business execution and preconditions.
2. React, Vite, TypeScript, TanStack Query, Lucide and Motion form the operator console. Native scrolling and reduced-motion support are part of its interaction design.
3. Express and explicit SQL replace the incomplete NestJS/Prisma scaffold. This makes transaction boundaries inspectable and allows the same queries in embedded and server PostgreSQL.
4. PostgreSQL is authoritative. PGlite provides a persistent single-process local mode; the pg adapter supports server PostgreSQL.
5. A database outbox with recoverable lease tokens drives dispatch. Redis/BullMQ are not included in this release; neither is needed for correctness at pilot scale.
6. Reports are deduplicated by full validated payload hash and scoped idempotency key. Correlation identifies one unresolved business problem. Fingerprint is similarity only.
7. Tenant row locks serialize writes, composite foreign keys enforce cross-resource tenant consistency, and expected case versions prevent lost operator updates. This intentionally trades write throughput for simplicity.
8. Delivery is at least once. The origin must atomically store command receipts with local mutations. External effects require origin-owned idempotency or reconciliation.
9. Action versions are immutable; current enable/revoke state is checked at invocation and again at dispatch. Revocation cannot undo a request already sent.
10. Action outcome and case disposition are separate. Only origin confirmation resolves or cancels a case. Unknown results never become assumed success/failure.
11. Poll-based SSE invalidation is scoped to the authenticated tenant. Five-second query polling and window-focus refetch recover missed notifications. SSE is not a durable event bus.
12. Local demo auth is explicit. Self-hosted pilots use configured hashed bearer tokens mapped to application-owned roles and tenants. Identity-provider login and automated credential rotation remain future work.
13. Callbacks authenticate raw bytes and stable request identity with HMAC, enforce timestamp windows, pin sockets to public DNS results, disable redirects and bound DNS/network/response size.
14. The canonical audit table has an append-only trigger. It is transactional history, not full event sourcing or protection against a database owner.
15. Unsupported schemas, high-risk actions and independent approvals are rejected. AI advice is not required for the recovery loop.
16. Related cases are deterministic observations, not causal recommendations. Metrics distinguish recovery, dismissal and cancellation.
17. CI includes server PostgreSQL; local tests use actual embedded PostgreSQL and real signed HTTP. Docker/hosted execution must be verified in the target environment.
18. Pagination, throughput tuning, SSO, rotation, a second production integration and design-partner feedback precede Kubernetes or AI expansion.
