# Security Baseline — Leather Lux India

| | |
|---|---|
| Version | 0.1 (Phase 0) |
| Verification references | OWASP ASVS 5.0.0, OWASP Top 10 2025, OWASP API Security Top 10 |
| Nature | Requirements and current gaps. Items are *requirements*, not claims of implementation. |
| Not legal advice | Privacy, GST and consumer-law items are engineering controls and must be reviewed by qualified legal and tax professionals. |

Each control has an owner phase. Status values: **Open** (not implemented), **Planned**, **Done** (implemented *and* tested). Everything is Open at Phase 0.

---

## 1. Principles

1. Secure by default; deny by default.
2. The server is the only authority for price, discount, stock, payment status, roles and ownership.
3. Least privilege everywhere: database roles, IAM, process users, security groups, admin permissions.
4. Defence in depth: each trust boundary re-validates.
5. No secrets in source, logs, frontend bundles or error responses.
6. Everything privileged is auditable.
7. A control counts as implemented only when a test proves it.

---

## 2. Trust boundaries and main threats

| Boundary | Principal threats | Primary controls |
|---|---|---|
| Browser → API | Credential stuffing, IDOR/BOLA, price tampering, injection, CSRF, XSS | §3–§6 |
| Razorpay → API webhook | Forged/replayed events, amount mismatch | §7 |
| Admin → API | Privilege escalation, session theft, insider abuse | §3, §4, §9 |
| Upload → S3 → public | Malware, polyglot images, stored XSS, SSRF | §8 |
| API → PostgreSQL/Redis | SQL injection, over-privileged DB user, exposed ports | §10, §11 |
| API → LLM | Prompt injection, data exfiltration, cost abuse | §12 |
| Supply chain | Malicious/vulnerable dependency, leaked secret, compromised CI | §13 |
| EC2 host | Exposed ports, weak SSH, metadata theft | §11 |

---

## 3. Authentication and sessions

| ID | Requirement | Phase | Status |
|---|---|---|---|
| A1 | Argon2id password hashing; parameters benchmarked on target host and stored per hash | 2 | Open |
| A2 | Password policy per NIST SP 800-63B: min 10–12 chars, no composition rules, check against breached-password list, max length ≥ 64 | 2 | Open |
| A3 | Email verification before activation; verification and reset tokens are 256-bit random, stored hashed, single-use, expiring (verify 24 h, reset 30 min) | 2 | Open |
| A4 | Enumeration-safe responses for login, register, forgot-password (same message and comparable timing) | 2 | Open |
| A5 | Login throttling per IP **and** per account with progressive delay; temporary lock notification; no permanent lock-out DoS | 2 | Open |
| A6 | Access token ≤ 15 min, asymmetric signing, `kid` rotation, no permissions embedded | 2 | Open |
| A7 | Refresh token rotation, hashed storage, family revocation on reuse, absolute and idle expiry | 2 | Open |
| A8 | Refresh cookie `__Secure-`, host-only, `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` | 2 | Open |
| A9 | Tokens never in `localStorage`/`sessionStorage`/URLs/logs | 2, 8 | Open |
| A10 | Session list and "log out other devices"; password change revokes all sessions | 6 | Open |
| A11 | Admin MFA mandatory (TOTP, later WebAuthn), recovery codes hashed, step-up for refunds/roles/settings | 2 | Open |
| A12 | New-device/location login notification email | 6 | Open |
| A13 | Account states (pending, active, suspended, deleted) enforced on every authenticated request | 2 | Open |

## 4. Authorization

| ID | Requirement | Phase | Status |
|---|---|---|---|
| Z1 | Database-backed RBAC with granular permissions; `requirePermission()` on every non-public route | 2 | Open |
| Z2 | Startup test fails if any route lacks an explicit policy (public / authenticated / permission) | 2 | Open |
| Z3 | Ownership enforced inside the query (`WHERE id=? AND user_id=?`); foreign IDs return 404 | 2–6 | Open |
| Z4 | Response mappers strip fields by permission (cost price, full PII) | 3, 6 | Open |
| Z5 | Role/permission changes cannot grant more than the actor holds; only Super Admin holds `roles.manage` | 2 | Open |
| Z6 | Permission cache invalidated immediately on role change | 2 | Open |
| Z7 | Mass-assignment protection: request schemas are strict (unknown keys rejected); never bind request bodies directly to ORM models | 2 | Open |
| Z8 | Client-supplied `role`, `userId`, `price`, `discount`, `paymentStatus`, `quantity-on-hand` are ignored/rejected | 2–5 | Open |

## 5. Input, output and API behaviour

| ID | Requirement | Phase | Status |
|---|---|---|---|
| I1 | Zod validation on params, query, body, headers; strict objects; length, range and enum limits | 2 | Open |
| I2 | Prisma/parameterised queries only; any raw SQL via tagged templates; lint rule to block string-built SQL | 2 | Open |
| I3 | Pagination: max page size; sort/filter keys from whitelists | 3 | Open |
| I4 | Body size limits per route (default 100 KB; uploads separate); JSON depth limit; collection-size limits (cf. zod advisory) | 2 | Open |
| I5 | Idempotency-Key on checkout, payment-create, refund | 4–5 | Open |
| I6 | Uniform error model; no stack traces, SQL, or internal paths in responses; correlation ID returned | 2 | Open |
| I7 | Output encoding by React; CMS content is structured blocks, no raw HTML or script; URL scheme allowlist | 3, 8 | Open |
| I8 | SSRF protection for any server-side fetch of user-influenced URLs: block private/link-local/metadata ranges, resolve-then-connect, scheme allowlist | 3–6 | Open |
| I9 | Business-logic abuse limits: coupon attempts, cart size/quantity (max 10 per line today), checkout attempts, review spam | 4–6 | Open |

### Rate limits (initial proposal, Redis-backed, tuned with real traffic)

| Endpoint group | Key | Limit |
|---|---|---|
| Login | IP + email | 5 / 15 min per email, 20 / 15 min per IP |
| Register | IP | 5 / hour |
| Forgot / reset password, resend verification | IP + email | 3 / hour |
| Product search & listing | IP | 120 / min |
| Cart mutations | session / IP | 60 / min |
| Coupon apply | user + IP | 10 / 15 min |
| Checkout / payment create | user | 10 / 10 min |
| Payment verify | user | 20 / 10 min |
| Webhooks | provider IP allowlist + signature | no user limit; body cap |
| Admin API | user | 300 / min; sensitive actions stricter |
| AI assistant | user + IP | 20 messages / hour; global daily cost cap |

## 6. Browser and transport security

| ID | Requirement | Phase | Status |
|---|---|---|---|
| T1 | HTTPS only; TLS 1.2+ (prefer 1.3); HSTS (`max-age=31536000; includeSubDomains`) enabled only after HTTPS verified, `preload` only if you decide | 10 | Open |
| T2 | CORS: explicit origin allowlist per environment, `credentials` only for those, no `*`, no reflection of arbitrary `Origin` | 2 | Open |
| T3 | Storefront headers (Vercel + server entry): `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (disable camera/mic/geolocation/payment unless needed), `frame-ancestors 'none'` | 8 | Open |
| T4 | API headers (Fastify helmet + Nginx): nosniff, `Cache-Control: no-store` on authenticated responses, no `Server`/`X-Powered-By` disclosure | 2 | Open |
| T5 | Self-host fonts and assets; no third-party scripts except Razorpay Checkout; SRI where a third-party asset is unavoidable | 8 | Open |
| T6 | CSRF: bearer-token API is not cookie-authenticated; cookie-authenticated routes (`/auth/refresh`, `/auth/logout`) require custom header + `Origin` check + `SameSite=Strict` | 2 | Open |
| T7 | Clickjacking protection via `frame-ancestors` and `X-Frame-Options: DENY` fallback | 8 | Open |

**CSP starting point (storefront)** — to be tightened against the real build and verified with Razorpay's current documentation at implementation time:

```
default-src 'self';
script-src 'self' https://checkout.razorpay.com;
style-src 'self' 'unsafe-inline';        # replace with nonces/hashes if feasible
img-src 'self' data: https://<media-cdn-domain>;
font-src 'self';
connect-src 'self' https://api.<domain> https://*.razorpay.com;
frame-src https://api.razorpay.com https://checkout.razorpay.com;
frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none';
```

## 7. Payments

| ID | Requirement | Phase | Status |
|---|---|---|---|
| P1 | Provider secret key server-side only; frontend receives key *id* and order ID | 5 | Open |
| P2 | Order amount computed from DB at checkout; gateway amount/currency compared to the order on confirmation | 5 | Open |
| P3 | Signature verification with constant-time compare (`timingSafeEqual`) | 5 | Open |
| P4 | Webhook: raw-body signature verification; `payment_webhook_events(provider, event_id)` UNIQUE; duplicates acknowledged, not reprocessed; processing inside a transaction | 5 | Open |
| P5 | Frontend "success" never marks an order paid; only verified server-side evidence does | 5 | Open |
| P6 | Reconciliation job for orphaned/pending payments | 5 | Open |
| P7 | Refunds need `refunds.approve`, idempotency key, audit row, cumulative cap check | 5 | Open |
| P8 | No card data stored or logged (SAQ-A posture via hosted checkout); log scrubbers for PAN-like patterns | 5 | Open |
| P9 | Live mode disabled by configuration until sandbox tests pass and you approve (gate G4) | 5 | Open |

## 8. Uploads and media

| ID | Requirement | Phase | Status |
|---|---|---|---|
| U1 | Extension + declared MIME + magic-byte check; allow only JPEG, PNG, WebP (AVIF optional); **SVG rejected** | 3 | Open |
| U2 | Size and dimension limits; decompression-bomb guard | 3 | Open |
| U3 | Decode and re-encode every image; strip EXIF/GPS | 3 | Open |
| U4 | Server-generated random filenames; user filename kept only as metadata, escaped on display | 3 | Open |
| U5 | Quarantine prefix → processed prefix; bucket blocks public access except served prefix; no `public-write`; CloudFront OAC if enabled | 3 | Open |
| U6 | Pre-signed POST with conditions (content-type, max size, key prefix), expiry ≤ 5 min | 3 | Open |
| U7 | Executable types and double extensions blocked; antivirus scan optional (ClamAV) for review uploads | 3, 6 | Open |

## 9. Audit and monitoring

| ID | Requirement | Phase | Status |
|---|---|---|---|
| L1 | `admin_audit_logs` written in the same transaction as the change; app DB role has no `UPDATE`/`DELETE`; trigger enforces | 1–2 | Open |
| L2 | Audited actions: user/role changes, price changes, inventory adjustments, order cancellations, payment/refund actions, coupon changes, settings changes, login/MFA events, permission denials | 2–6 | Open |
| L3 | Structured logs with request ID; **redaction list:** `authorization`, `cookie`, `set-cookie`, `password`, `token`, `refresh*`, `secret`, `otp`, `card*`, `cvv`, email/phone masked by default | 2 | Open |
| L4 | Alerting on: refresh-token reuse, webhook signature failures, repeated 403s, admin login from new IP, payment amount mismatch, backup failure | 9–10 | Open |
| L5 | Log retention 30 days (proposal) with access restricted | 10 | Open |

## 10. Database

| ID | Requirement | Phase | Status |
|---|---|---|---|
| D1 | Three DB roles: `llx_migrator` (DDL, used only in the migration step), `llx_app` (DML only), `llx_readonly` (reporting). No superuser in the app | 1 | Open |
| D2 | `CHECK` constraints for stock, money, status; FKs; `statement_timeout`, `idle_in_transaction_session_timeout` | 1 | Open |
| D3 | TLS to PostgreSQL if not on loopback; `pg_hba.conf` limited to app host/security group | 1, 10 | Open |
| D4 | Encrypted storage; encrypted, access-controlled backups; documented restore with a tested drill | 9–10 | Open |
| D5 | Sensitive columns (e.g. TOTP secrets) encrypted at the application layer with a key outside the database | 2 | Open |
| D6 | No destructive migration without a verified backup and approval (gate G1) | 1+ | Open |

## 11. Infrastructure (EC2, Nginx, Redis, AWS)

| ID | Requirement | Phase | Status |
|---|---|---|---|
| H1 | Security groups: 443/80 public; SSH from fixed IP or SSM only; **5432 and 6379 never public** | 10 | **Unverified — current state unknown** |
| H2 | Redis: bind to private/loopback address, `requirepass`/ACL user, `protected-mode yes`, dangerous commands renamed/disabled, TLS if remote | 2, 10 | **Unverified** |
| H3 | IMDSv2 required on EC2; instance role with least privilege (S3 prefix, SES send, Secrets Manager read) | 10 | Unverified |
| H4 | App runs as a non-root user; PM2 under that user; file permissions on env files `600` | 10 | Unverified |
| H5 | Nginx: TLS config, request body/time limits, `limit_req`, hide version, deny dotfiles, separate access logs | 10 | Unverified |
| H6 | OS patching cadence, unattended security updates, host firewall as second layer | 10 | Unverified |
| H7 | Secrets via environment from AWS Secrets Manager/SSM Parameter Store (preferred) or a root-owned env file; never in repo or PM2 config | 10 | Open |
| H8 | S3: Block Public Access on, versioning on backup bucket, SSE-KMS/SSE-S3, lifecycle rules | 3, 10 | Open |

## 12. AI assistant

| ID | Requirement | Phase | Status |
|---|---|---|---|
| M1 | Provider key backend-only; admin UI never reveals it | 7 | Open |
| M2 | Model has only fixed read-only tools over published catalogue; no SQL, no order/payment/customer/admin tools | 7 | Open |
| M3 | Commercial facts rendered from DB by product ID; model text cannot assert price/stock/discount | 7 | Open |
| M4 | Prompt-injection hardening: delimit untrusted input, strip/neutralise instructions in product data, output validation, refusal on out-of-scope requests | 7 | Open |
| M5 | Per-user and global rate/cost limits, timeouts, circuit breaker | 7 | Open |
| M6 | Conversations isolated per user/session; retention + deletion; minimal summaries | 7 | Open |

## 13. Supply chain, CI and secrets

| ID | Requirement | Phase | Status |
|---|---|---|---|
| S1 | One lockfile per package, `npm ci` in CI, exact Node version | 0.5 | Partly done — npm only, `package-lock.json` sole lockfile, `engines`/`packageManager` set; `npm ci` in CI pending |
| S2 | `npm audit` (fail on high/critical) + Dependabot/Renovate | 0.5, 9 | Partly done — `audit:prod` script added, 0 prod vulnerabilities; CI + Dependabot pending |
| S3 | Secret scanning (gitleaks) in CI and as pre-commit; GitHub push protection on | 0.5 | Open (repository now known; needs CI workflow and GitHub setting) |
| S4 | `.gitignore` covers `.env*`, keys, certs | 0.5 | **Done** (2026-10-31) |
| S5 | GitHub Actions pinned to commit SHAs; least-privilege `GITHUB_TOKEN`; production deploy needs environment approval; deploy credentials via OIDC rather than long-lived keys | 10 | Open |
| S6 | Remove unused dependencies (≈45 unused generated UI components and their Radix packages) | 0.5 | **Done** — 44 components and 37 packages removed |
| S7 | Migrations validated in CI against a throw-away database | 1 | Open |
| S8 | SBOM generation and licence check | 9 | Open |

## 14. Privacy and data protection (engineering controls)

To be mapped in a compliance matrix in Phase 6 and **reviewed by counsel**: DPDP Act 2023 and Rules 2025 (as commenced), Consumer Protection (E-Commerce) Rules 2020 and the 2026 amendments (effective 1 Jan 2027 per your brief), GST, Legal Metrology.

| Data class | Examples | Handling |
|---|---|---|
| Credentials | password hash, TOTP secret, refresh-token hash | Never logged; TOTP encrypted at rest |
| Contact PII | name, email, phone, address | Masked in logs/lists; role-restricted in admin |
| Transactional | orders, invoices, payment references | Retained per tax law (period to be confirmed by CA) |
| Payment | provider payment/refund IDs | No PAN/CVV ever |
| Behavioural | AI chats, wishlist, search | Minimised; retention limit; deletable |
| Consent | privacy-notice version, marketing opt-in/out, timestamps | Immutable log |

Controls: privacy notice shown at collection with version recorded; separate marketing consent (no pre-ticked boxes), one-click withdrawal; access/correction/erasure workflow with identity verification and legal-hold exceptions; retention jobs; breach-response runbook; grievance officer contact and workflow; no unnecessary data collected.

---

## 15. Findings against the current repository (carried from Phase 0)

| # | Severity | Finding | Location | Target |
|---|---|---|---|---|
| F1 | Medium | ~~`.gitignore` omits `.env*`, key and cert patterns~~ **Fixed in Phase 0.5** | `.gitignore` | Done |
| F2 | Medium | No security headers; third-party Google Fonts | `src/server.ts`, `__root.tsx` | Phase 8 |
| F3 | Medium | Cart/wishlist trusted from `localStorage` without schema validation; unknown slugs counted; price/stock computed client-side | `src/lib/store.tsx` | Phase 8 (server-backed) |
| F4 | High (advisory) | ~~`vite` 8.0.0–8.1.5 advisories~~ **Fixed:** upgraded to 8.3.5 (removed Lovable `rolldown` override) | `package.json` | Done |
| F5 | High (advisory) | ~~`zod` < 4.6.6~~ **Fixed:** frontend on 4.6.7; backend must use ≥ 4.6.6 | `package.json` | Done (frontend) |
| F14 | Low | `minimatch` DoS advisory in ESLint toolchain (dev-only, not shipped); npm's suggested fix is a downgrade | dev dependencies | Accepted; revisit on next `typescript-eslint` release |
| F6 | Low | `q` search param unbounded; throwing `parse()` | `collections.$slug.tsx` | Phase 8 |
| F7 | Low | `addToCart` does not verify colour/size belongs to product | `store.tsx` | Phase 8 (server validates) |
| F8 | Low | Process-global `lastCapturedError` shared across concurrent SSR requests; `console.error` override emits up to 8 000 characters of stack/cause | `src/lib/error-capture.ts` | Phase 8 |
| F9 | Low | CSRF middleware filtered to server functions only | `src/start.ts` | Phase 8 |
| F10 | Info | Closed drawers remain keyboard-focusable; no focus trap | `Panels.tsx`, collection filter drawer | Phase 8 |
| F11 | Medium | Fabricated reviews and "sample" stock/delivery claims shown to shoppers | `products.$slug.tsx` | Phase 8 |
| F12 | Low | Lovable telemetry hook (`__lovableEvents`, `__lovableReportRuntimeError`) forwards error messages | `lovable-error-reporting.ts` | Phase 8 |
| F13 | Info | ~~337 Prettier errors mask real lint failures~~ **Fixed:** lint now 0 errors, 2 dev-only warnings | repo-wide | Done |

## 16. Out of scope / explicit non-claims

- No penetration test has been performed; none of the controls above is yet implemented.
- Legal and tax compliance is not asserted; it requires professional review.
- Infrastructure hardening status is **unknown** until the EC2 environment is inspected with your authorisation.
