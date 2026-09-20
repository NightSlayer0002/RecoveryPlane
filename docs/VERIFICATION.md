# Release verification

Verified locally on Windows with Node.js and pnpm, 20 September 2026.

- `pnpm install --frozen-lockfile`: passed.
- `pnpm build`: passed, including backend type checking, SDK declarations, and the React production bundle.
- `pnpm test`: 19 passed, 0 failed, 0 skipped. Includes real local signed HTTP delivery and filesystem persistence across a database restart.
- Browser: patched a vendor country, observed a successful command with the case still open, retried verification, and observed an origin-confirmed recovered case and two applied mutations.
- Browser: dismissed a separate sample with a required reason; confirmed the reason in the audit trail and disabled recovery actions.
- Browser: inspected the desktop sticky walkthrough and stage changes during native scrolling, plus the stacked chapters and navigation at 390px. No page-level horizontal overflow was observed.
- Reduced motion was enabled on the test device. The walkthrough kept its progress line static and changed stage emphasis as expected. The normal animated progress line was checked in source and compiled, but was not exercised with that device preference disabled.
- Independent review found and resolved correlation identity, dismissal input, DNS timeout, and shutdown race issues. See [review findings](review-findings.md).

Docker and standalone PostgreSQL were unavailable locally. Their configuration is included; GitHub Actions runs the domain and HTTP suites against PostgreSQL 16 after publication. Those paths are not represented as locally verified. Load testing and an independent production security review remain future work.

The local Git repository is initialized on `main`. No remote or commit identity was configured, so no commit or GitHub push was made. Demo data, generated outputs, logs, and real environment files are excluded by `.gitignore`.
