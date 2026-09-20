# Security and deployment

Use an isolated demo workspace containing sample data only. `pnpm dev` explicitly enables demo login; its role selector is an educational facility, not an identity provider. Demo credentials and all three sample roles have access to that sample workspace. The API refuses a public demo bind unless `ALLOW_PUBLIC_DEMO=true` is explicitly set. Never point the demo at customer systems.

For a self-hosted pilot, disable demo mode, serve the console/API on one HTTPS origin behind a reverse proxy, and provision distinct random access tokens using `pnpm token:create`. `ACCESS_TOKENS_JSON` holds SHA-256 token hashes and server-owned user/organization/role mappings. Protect this configuration; remove a token entry and restart to revoke it. Browser tokens live only in sessionStorage. Treat access tokens as bearer credentials: XSS in the console would expose them. SSO, MFA, human session revocation, and automated credential rotation are future work.

Reporting keys only ingest reports for their integration. Human admins provision destinations and immutable action versions. Result callbacks authenticate raw bytes, timestamp, and integration/command identity with HMAC-SHA256. Both sides deduplicate durable command identities. Signatures expire after five minutes, but an in-window duplicate is still possible and must remain idempotent. Signing secrets are stored in the database so the worker can sign commands; use encrypted disks/database backups and restrict DB access. A managed KMS envelope and credential rotation endpoint are not implemented.

Callbacks require public HTTPS and reject redirects, credentials in URLs, private/special addresses, oversized responses and expired deadlines. The socket uses the approved IP with normal TLS hostname verification. Only the single configured demo loopback destination can use HTTP. Add network-level egress controls in deployment as defense in depth.

Organization row locks serialize mutations within each tenant. Composite foreign keys prevent cross-tenant case/action/command links. The audit table rejects application UPDATE and DELETE through a trigger; a database owner can still change schema or disable that trigger. Use separate migration/runtime roles for a hardened deployment. The baseline migration currently runs at process startup.

The built-in rate limiter is per process, based on socket IP. Put a per-user/IP limiter at the reverse proxy for public access; otherwise proxy clients share one bucket. The API deliberately does not trust arbitrary forwarded headers. TLS termination, backups, restore drills, secret rotation and monitoring are deployment responsibilities.

Report vulnerabilities privately to the repository maintainer. Do not include real credentials or customer data in public issues.
