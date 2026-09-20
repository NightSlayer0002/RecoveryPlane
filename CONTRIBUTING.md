# Contributing

Use Node.js 22+ and pnpm 9.1.0. Install with `pnpm install --frozen-lockfile`, then run `pnpm dev` for the isolated sample workspace. See [README.md](README.md) for configuration.

Before opening a pull request, run:

```sh
pnpm build
pnpm test
```

Explain the problem, the resulting behavior, and the verification performed. Include screenshots for visible interface changes. Add regression coverage for changes to authorization, transactions, command identity, or recovery state. Use sample data only.

Preserve the recovery invariants in [docs/PRODUCT.md](docs/PRODUCT.md): origin-confirmed recovery, stable command identities, explicit unknown outcomes, tenant boundaries, and transactional audit/outbox writes. Database changes need a migration strategy for existing installations.

Report ordinary bugs through GitHub Issues with reproduction steps and sanitized output. For vulnerabilities, use the repository's private security reporting option when enabled; otherwise contact the maintainer privately before sharing details. Never post credentials or customer data in an issue.
