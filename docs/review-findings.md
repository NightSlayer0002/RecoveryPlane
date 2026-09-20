# Independent correctness review

Reviewed the API/domain, dispatcher/HTTP transport, origin demo, SQL schema/store, SDK and console against PRODUCT.md and HTTP-CONTRACT.md. This review changed no implementation files. A scoped rereview verified fixes for all four findings below. Original sequences and original line references are retained as review history.

Rereview validation: `node --import tsx --test --test-concurrency=1 tests/domain.test.ts tests/lifecycle.test.ts` passed all 12 tests. Console dismissal was verified by inspection of its reason field, validation, client type and submitted payload; the separate browser walkthrough belongs to the main implementation task. No outstanding important finding was identified in the four fixes.

## Important findings

### Resolved — P1: Different unresolved problems can silently merge

- Resolution: `apps/api/src/domain/service.ts:99,111` persists exception type and execution ID and compares them, plus the step, before merging. The new regression test rejects the reproduced cross-problem sequence; the existing same-problem merge test still passes.

- Location: `apps/api/src/domain/service.ts:94–99` (case creation at line 109 also omits exception type and execution identity).
- Sequence: report a missing-country exception for vendor 1, onboarding/address/run-one; then send a new idempotency key with the same correlation key/entity/workflow but invalid-bank-account, payment/run-two. The second report joins the first case. Its exception, step, context and available recovery actions are discarded, leaving operators with the first problem's actions.
- Evidence: an isolated PGlite reproduction returned `{ "merged": true, "occurrences": 2, "storedStep": "address" }` for that sequence.
- Fix: define and persist problem identity (including relevant exception type/step/execution identity), and reject conflicting correlation reuse. Continue treating fingerprint as similarity only. If callers are intentionally solely responsible for problem identity, narrow the product invariant and explicitly document this otherwise silent behavior.

### Resolved — P2: Dismiss case cannot succeed from the console

- Resolution: `apps/web/src/case-page.tsx:10,18` collects and validates a trimmed dismissal reason, and sends it as `note`; `apps/web/src/api.ts:31` now permits that field. The modal prevents empty submission and preserves the reason for API error recovery.

- Locations: `apps/web/src/case-page.tsx:18` (dismissal modal on the long JSX line), `apps/web/src/api.ts:31`; requirement in `apps/api/src/domain/service.ts:144`.
- Sequence: open any open case without an active command, click Dismiss case, confirm. The console sends `{ version, status: 'DISMISSED' }`, but the service requires a nonempty `note`. Every attempt fails with HTTP 400.
- Evidence: the exact console payload was reproduced against an isolated service and returned `400: A dismissal reason is required`.
- Fix: collect the reason in the dismissal modal, include `note` in the client type and request, and disable submission until valid.

### Resolved — P2: Delivery timeout excludes DNS resolution

- Resolution: `apps/worker/src/transport.ts:17–34` bounds destination resolution; `createTransport` starts timing before resolution and subtracts that elapsed time from the socket deadline. A timed-out resolver rejects before request creation and cannot later resume dispatch. The injected never-resolving DNS regression passes. Native resolver work is not itself cancelled, but it no longer blocks the dispatcher awaiting its result.

- Locations: `apps/worker/src/transport.ts:26,32,49`.
- Sequence: an already registered callback's DNS resolver becomes slow or unresponsive. `approvedDestination()` awaits `lookup()` before the transport starts its eight-second timer. The dispatcher awaits this call and processes candidates sequentially, so the advertised delivery bound and lease assumptions no longer hold. All subsequent deliveries in this process wait; another worker may reclaim the expired lease while the original worker is still resolving.
- Evidence: direct control-flow inspection; no network fault was injected.
- Fix: start one deadline before destination resolution and apply it to DNS and socket work; ensure an expired resolution never goes on to send a request. Registration lookup should also have a bound.

### Resolved — P2: Graceful API shutdown loses the in-flight dispatcher promise

- Resolution: `apps/worker/src/lifecycle.ts:1–8` retains the actual active tick and skips overlapping intervals; its `stop()` clears the timer and awaits that promise. `apps/api/src/main.ts:26–31` awaits `stop()` before closing origin/server/database. The regression keeps delivery outstanding over multiple intervals and verifies shutdown remains pending until delivery finishes.

- Locations: `apps/api/src/main.ts:25–31`, `apps/worker/src/dispatcher.ts:10–11`.
- Sequence: a callback takes longer than one second. The next interval calls `tick()`, which immediately returns because `running` is true; the timer overwrites `active` with that already-resolved promise. SIGTERM then awaits the wrong promise and closes the origin/server/database while the original tick is still processing its delivery. Delivery bookkeeping may fail against the closed DB and a committed origin outcome is left for lease recovery after restart.
- Evidence: direct control-flow inspection; process termination was not injected into the active application.
- Fix: keep the actual in-flight tick promise until its finalizer runs, avoid overwriting it with overlapping calls, and await it before closing dependent resources.

## Deployment limitations to state accurately

- Server PostgreSQL, Docker startup, TLS/reverse-proxy deployment and concurrent multi-process startup need separate verification; PGlite test success alone does not establish these.
- PGlite and the embedded demo origin share one process/database. They are local pilot facilities; the standalone worker requires server PostgreSQL.
- Access tokens are static startup configuration, demo sessions are in memory, and reporting/signing credential rotation has no public endpoint. Provisioning, revocation/restart and secret backup procedures are operator responsibilities.
- `createTransport` validates a public address and pins each request's socket to it; this is per-delivery validation, not permanent pinning of the originally registered address. Only explicitly configured demo loopback HTTP is allowed.
- Rate limiting is in-process and based on `req.ip`; behind a reverse proxy without trusted-proxy configuration, clients share the proxy's 600-request/minute bucket. Polling/SSE/read traffic consumes the same bucket.
- Lists load all tenant cases and filter in memory, delivery dispatch is sequential, and there is no retention/pagination. This is a bounded self-hosted pilot, not evidence of high-volume production capacity.
- Origin command receipts must be durable and atomic with the business mutation. The demo proves this only for mutations in the same SQL transaction; external effects require an origin-owned idempotency protocol.
- Development databases created before problem-identity persistence lack `executionId`/`exceptionType` in existing cases. They need a deliberate migration or a fresh local demo database before relying on further correlated reports; this prerelease fix is not a historical-data migration.

No confirmed cross-tenant data leak was found in the reviewed API paths. Tenant locks and composite foreign keys support isolation; this statement is limited to inspection and the supplied tests, not a security certification.
