# Frontend implementation report

The existing RecoveryPlane console implementation was retained and checked against `docs/frontend-brief.md` and `docs/HTTP-CONTRACT.md`. Work was limited to `apps/web` and this report.

## Console coverage

- Typed authenticated API client, sessionStorage tokens, demo role chooser, provisioned-token login, health indicator, and explicit sign out.
- Responsive sidebar, inbox metrics from the API, status/search/priority/source filters, linked case table, and loading/error/empty states.
- Case context, schema-driven action forms, target/input confirmation, expected case version and stable idempotency key, conflict refresh, same-command unknown-outcome retry, delivery history, audit timeline, notes, owner/priority changes, dismissal confirmation, and related cases.
- Integration listing/details, admin-only settings, create integration with one-time credentials, action registration with JSON Schema checks, and enable switches.
- Actual demo scenario requests, durable vendor table, recovery walkthrough, real activity feed, and API help.
- Five-second polling and focus refetch; authenticated fetch SSE invalidates cached data. Polling remains active after stream failure.

## Finishing changes

- `apps/web/src/App.tsx`: replaced ES2021 `replaceAll` with ES2020-compatible replacement; keyed the case page by route so pending confirmations and notes reset when moving between cases.
- `apps/web/src/ui.tsx`: replaced `replaceAll` in label formatting with an ES2020-compatible regular expression.
- `apps/web/src/case-page.tsx`: replaced `replaceAll` in context labels with an ES2020-compatible regular expression.
- `apps/web/src/pages.tsx`: added `aria-pressed` to the selected inbox status filter.
- `apps/web/src/styles.css`: strengthened light-surface text and semantic status contrast, set a darker ink sidebar, raised small mobile helper text, and ensured status filter containers can shrink.

## Verification

`pnpm.cmd --filter @recoveryplane/web build` passed after the final edits: TypeScript completed with no errors, Vite transformed 1,555 modules and produced the production bundle (238.48 kB JS, 33.53 kB CSS; 72.60 kB and 8.37 kB gzip respectively). The initial failure identified three `replaceAll` uses incompatible with the project's ES2020 library target; all were removed.

The installed bundled pnpm required execution outside the filesystem sandbox because its runtime could not resolve the user directory. The authorized escalated build completed successfully.

## Remaining verification / notes

- The parent task owns live browser smoke testing against the finalized backend. This report does not claim browser or end-to-end verification.
- SSE is best-effort and does not reconnect itself after a disconnected stream; required polling/focus refresh remains enabled.
- No frontend test framework was introduced for this finishing pass. Production compilation and source/API-contract inspection were performed.
- No Git metadata is available in this workspace, so Git diff/status verification was unavailable.

## Review follow-up: required dismissal reason

Verified the reviewer finding against `apps/api/src/domain/service.ts`: dismissal rejects a missing reason, and supplied notes are trimmed with a 1–2,000-character server limit.

- `apps/web/src/api.ts`: added `note?: string` to the typed update-case request.
- `apps/web/src/case-page.tsx`: dismissal now uses a form with a required reason, a 3–2,000-character UI limit, whitespace-aware validation, disabled submission until valid, and the trimmed reason sent as `note`. The modal displays request failures and clears its reason when reopened or after success.
- Verification: `pnpm.cmd --filter @recoveryplane/web build` passed after this fix (TypeScript clean; Vite 1,555 modules; 239.14 kB JS, 72.77 kB gzip). Live dismissal/browser verification remains with the parent task; no browser test is claimed here.
