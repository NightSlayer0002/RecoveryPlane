# Architecture and recovery guarantees

RecoveryPlane is a control plane for exceptions. It does not store or own workflow execution state.

## Durable boundaries

- Ingestion commits the case, occurrence, immutable action references and audit event together. A case already exists when the API returns. SSE polls the authoritative audit table; no durable SSE outbox is required.
- Invocation commits the recovery command, changed case version, audit event and outbox row in one transaction.
- The dispatcher acquires an expiring lease token, commits, and delivers outside the database transaction. It checks current integration/action restrictions before sending.
- A result commits the command result, case disposition, outbox completion and audit events together. Only the current lease may write delivery progress; an authenticated origin callback or newer lease wins over a stale worker.

## Identity and concurrency

An integration belongs to one organization and one environment. Reporting keys resolve that identity server-side. Composite foreign keys connect cases, available actions, commands and occurrences within that identity. Human tokens resolve an application-owned organization and role. Nested resources, timeline, lists, metrics and event subscriptions are tenant-scoped.

A report idempotency key deduplicates a full validated payload. Changed reuse returns 409. A correlation key joins only an open case for the same entity, workflow, step, execution and exception type. Fingerprints show similar cases without merging them. A partial unique index enforces one open case per integration/correlation and another enforces one active recovery command per case.

Tenant row locks serialize writes at this scale. Case versions detect stale operator changes. Action request idempotency survives a lost API response; a replay returns the existing command even when the case version has advanced.

## State semantics

Cases: OPEN, RESOLVED, CANCELLED, DISMISSED.

Commands: QUEUED, AWAITING_CONFIRMATION, OUTCOME_UNKNOWN, SUCCEEDED, FAILED, BLOCKED. QUEUED/AWAITING_CONFIRMATION/OUTCOME_UNKNOWN are active and prevent new commands. BLOCKED means a never-delivered action was revoked; revocation after a possible delivery preserves OUTCOME_UNKNOWN.

The origin returns an action outcome independently of its case disposition. A patch succeeds with UNCHANGED. Successful verification returns RESOLVED. Cancellation returns CANCELLED and does not improve the recovery rate. Dismissal is an operator decision with a required reason and is prohibited while a command is active.

## Failure windows

| Failure                                    | Behavior                                             |
| ------------------------------------------ | ---------------------------------------------------- |
| Duplicate report                           | Same case, one occurrence                            |
| Changed report with reused key             | Explicit 409                                         |
| API dies before transaction commit         | No partial command/audit/outbox                      |
| API dies after commit before response      | Same request key returns existing command            |
| Worker dies before delivery                | Expired lease is reclaimed                           |
| Origin commits and response is lost        | Unknown outcome; same command is redelivered         |
| Worker dies after origin result            | Durable origin receipt replays its exact result      |
| Old worker completes after lease reclaimed | Lease token check prevents stale state regression    |
| Duplicate/conflicting origin result        | Identical result accepted; changed result rejected   |
| Revoked action on historical case          | Invocation and dispatch blocked                      |
| Revocation after uncertain delivery        | No future dispatch; previous outcome remains unknown |
| Browser misses an event                    | Polling/focus refetch converges                      |

The default dispatcher leases for 30 seconds, bounds an HTTP delivery to eight seconds including up to three seconds of DNS resolution, and bounds response bodies to 64 KB. It automatically tries up to three deliveries with backoff. Exhausted commands remain unknown and can be manually reconciled without changing identity. An origin is responsible for durable idempotency and checking current business preconditions.

## Storage and runtime

PGlite stores local data in `.data/recoveryplane`; only one process may open that path. Server PostgreSQL permits separate API/worker processes. Demo vendor/receipt tables share the local database but use an independent origin transaction. SQL schema creation runs at startup; introduce numbered migrations before changing deployed columns. Audit UPDATE/DELETE are rejected by a trigger, but the database owner can alter it.

## Honest limits

No exactly-once delivery claim, SSO/MFA, independent reviewer approval, AI advice, external-effects atomicity, high-volume benchmark, durable browser streaming, or automatic arbitrary workflow resumption. Lists currently load tenant cases in memory, dispatch is sequential, and rate limits are in-process. See SECURITY.md for deployment responsibilities.
