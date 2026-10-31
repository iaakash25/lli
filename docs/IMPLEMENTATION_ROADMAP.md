# Implementation Roadmap — Leather Lux India

Companion to `PROJECT_AUDIT.md` and `SYSTEM_ARCHITECTURE.md`. Updated at the end of every phase.

**Working rules**

- One phase at a time; each phase ends with tests run, results reported and this file updated.
- Small, reviewable changes on feature branches. No force-pushes or history rewrites (Lovable sync).
- Stop for explicit approval before anything **destructive, financial, credential-sensitive or production-impacting**. The approval gates are listed in §4.
- A phase is *complete* only when its security and error-handling requirements are implemented and its tests have actually run.

---

## 1. Status

| Phase | Name | Status |
|---|---|---|
| 0 | Audit and architecture | **Documents written; awaiting your answers to §3 before Phase 1** |
| 0.5 | Repository hygiene | **Done locally; awaiting your approval to commit and push** — see §2a |
| 1 | Database foundation | Not started |
| 2 | Backend foundation and security | Not started |
| 3 | Catalogue and administration | Not started |
| 4 | Shopping operations | Not started |
| 5 | Payments, shipping, order operations | Not started |
| 6 | Customer and business features | Not started |
| 7 | AI and automation | Not started |
| 8 | Frontend integration | Not started |
| 9 | Testing and hardening | Not started |
| 10 | Staging and production readiness | Not started |

Phase 0 limitations: no git history, no `.env`, and no AWS/PostgreSQL/Redis access were available, so infrastructure facts are **unverified** (Audit §7). No remote system was contacted.

---

## 2. Phases

### Phase 0.5 — Repository hygiene (new; small, prerequisite)

Purpose: make later changes reviewable and CI-able without touching the design.

| Work | Detail |
|---|---|
| Version control | Confirm GitHub remote; create working branch; commit the current state untouched as a baseline |
| `.gitignore` | Add `.env`, `.env.*` (except `.env.example`), `*.pem`, `*.key`, `coverage/`, `.vercel/` |
| Lockfile | Keep one lockfile per package (decision D2) |
| Formatting | Run Prettier once as a **format-only commit** (337 lint errors are formatting) so lint is meaningful |
| Lint | Triage the 8 warnings |
| Dependency advisories | Evaluate `vite` ≥ 8.3.5 and `zod` 4.x upgrades as isolated changes with a build + test run each |
| Dead weight | Remove unused generated UI components and their Radix dependencies after confirming no imports (only `sonner` is used today) |

Exit: `tsc`, `eslint`, `vitest`, `vite build` all green; `npm audit` clean or each remainder documented.

#### 2a. Phase 0.5 result (2026-10-31)

| Work item | Outcome |
|---|---|
| Baseline snapshot | Archive of the pre-change tree (117 files, excluding `node_modules`/build output) kept outside the project in the session scratchpad. Not a substitute for git. |
| `.gitignore` | Added `.env`, `.env.*` (allowing `.env.example`), key/cert patterns, `.vercel/`, `coverage/`, `*.tsbuildinfo`. |
| Unused UI | Deleted 44 unused generated shadcn components and `hooks/use-mobile.tsx` (only `ui/sonner.tsx` is used). Found by import-graph analysis from all non-UI source. |
| Unused dependencies | Removed 37 packages: all `@radix-ui/*`, `@hookform/resolvers`, `react-hook-form`, `class-variance-authority`, `cmdk`, `date-fns`, `embla-carousel-react`, `input-otp`, `react-day-picker`, `react-resizable-panels`, `recharts`, `vaul`. Kept build-time packages that source does not import (`tailwindcss`, `@tailwindcss/vite`, `tw-animate-css`, `@tanstack/router-plugin`, `vite-tsconfig-paths`, `react-dom`). |
| Formatting | Prettier applied to `src/` and config files. Compiled output of every changed file compared against the original: identical except four files where a trailing space inside JSX text became an explicit `{" "}` (same rendered text, split into two adjacent text nodes). |
| Lint warnings | 8 → 2. Both are dev-only Fast Refresh notices (`NAV` export in `Header.tsx`, `useStore` export in `store.tsx`); intentionally left, no behaviour impact. |
| `zod` | `^3.25.76` → `^4.6.7` (advisory fixed). Only use is one `z.object({ q: z.string().optional() })`; type-check, tests, build and dev-server route checks pass. |
| `vite` | `8.1.5` → `8.3.5` (advisories fixed; 8.3.5 is older than the repository's 24 h release-age guard). **Required removing the Lovable template's `overrides.rolldown: 1.2.1`**, because `vite` 8.3.5 needs `rolldown ~1.2.14` (resolved to 1.2.16). |
| Scripts | Added `typecheck`, `format:check`, `audit:prod`, and `verify` (typecheck → lint → format check → test → build → audit). |
| Result | `npm run verify` passes. `npm audit --omit=dev`: **0 vulnerabilities**. Full `npm audit`: 1 moderate (`minimatch` DoS in the ESLint toolchain, dev-only; npm's suggested fix would downgrade `typescript-eslint`, so it is documented, not applied). Dev server returns 200 for `/`, `/collections/all`, `/collections/gifts?q=wallet`, `/products/aria-top-handle` and 404 for unknown product/collection. |

**Decisions resolved after the first pass:**

- **D2 — npm only (decided 2026-10-31).** `bun.lock` deleted (it is in the baseline snapshot). `package-lock.json` is the sole lockfile; `npm ci --dry-run` confirms it matches `package.json`. Added `packageManager: npm@11.6.2`, `engines` (`node >=22.12.0`, matching `vite` 8's requirement) and a `.npmrc` (`engine-strict`, `audit-level=high`). `bunfig.toml` is left in place but is inert unless bun is run; its 24-hour release-age guard has no npm 11.6 equivalent, so dependency age is controlled through Dependabot cooldowns in CI instead.
- **D1 — repository `https://github.com/iaakash25/lli.git` (provided 2026-10-31).** Inspected read-only: one branch (`main`), one commit (`cee0edc`, "Initial commit"), one file (`README.md`). **No Lovable-synced history exists in it**, so the "never rewrite pushed history" constraint has nothing to protect there today. The local folder is linked to it as `origin` on branch `chore/phase-0.5-hygiene` (based on `cee0edc`); **nothing is committed or pushed**. Repository root = the folder that holds `package.json` (so Lovable, which expects the app at the repo root, remains compatible); `backend/` and `admin/` will be added as sibling folders.
- **Open question:** the Lovable project is not connected to this repository (its content would otherwise be present). If you want two-way Lovable sync later, connect it deliberately; Lovable edits and these backend changes would then land on the same branch.

**Proposed commit plan (awaiting approval; gate G8 is respected — no force-push, no rewrite):**

1. `chore: import Lovable prototype baseline` — the original 117-file tree, taken from the baseline snapshot (so the history shows the true "before").
2. `chore: harden .gitignore, adopt npm only` — `.gitignore`, `.npmrc`, `package.json` metadata, removal of `bun.lock`.
3. `chore: remove unused UI components and dependencies`.
4. `style: apply Prettier` (format-only).
5. `chore: upgrade vite and zod to patched versions`.
6. `docs: Phase 0 audit, architecture, roadmap, security baseline`.

Pushed to `chore/phase-0.5-hygiene` for a pull request into `main`; no direct push to `main`.

### Phase 1 — Database foundation

- **Read-only inventory first** of the existing PostgreSQL (version, schemas, tables, row counts, roles, extensions). Nothing applied.
- Verified backup of any existing data before any migration is proposed. Migration + rollback plan documented and **approved by you**.
- Prisma schema for all domains in the brief (identity, catalogue, inventory, cart/wishlist, orders/payments, promotions, shipping/returns, reviews/CMS, admin/audit, AI) with constraints, check constraints, partial unique indexes and search indexes.
- Raw-SQL migrations for what Prisma cannot express (CHECKs, audit-table trigger, generated `tsvector`, extensions `pgcrypto`/`pg_trgm`, DB roles).
- Seed script (development only): 22 current products converted to variants/SKUs/paise, 8 collections, categories, RBAC roles and permissions, one-time admin bootstrap via CLI prompt (no default password).
- Docs: `DATABASE_ERD.md`, `DATABASE_DICTIONARY.md`.
- Tests: migrations apply to an empty database, apply to a copy of staging, and roll back; constraint tests (negative stock rejected, status values enforced, audit table immutable).

Exit: schema reviewed and approved; applied **only to local/staging** databases.

### Phase 2 — Backend foundation and security

Config (Zod-validated env, fail-fast), Pino logging with redaction, request IDs, error model, health/ready, graceful shutdown, security headers, CORS allowlist, rate limiting (Redis), registration/login/logout/refresh/verify/forgot/reset/me, Argon2id, refresh-token rotation with reuse detection, sessions, RBAC (`requirePermission`, deny-by-default startup check), MFA for admin (TOTP first), audit logging, OpenAPI skeleton.

Tests: auth unit + integration, token rotation/reuse/revocation, brute force and lockout, enumeration-safe responses, RBAC matrix, customer isolation harness.

Exit: authentication and authorization verified by automated tests and a manual security checklist.

### Phase 3 — Catalogue and administration

Products/variants/SKUs, categories (nested), collections (rule- and manual-based), attributes, media pipeline (presigned upload → validate → re-encode → S3), inventory (adjustments, movements, thresholds), public catalogue API with filter/sort/search/pagination, Redis cache with invalidation, admin product/category/collection/inventory/CMS APIs, admin app skeleton on `admin.<domain>`.

Tests: pricing, search/filter whitelists, upload attacks (wrong MIME, polyglot, oversize, SVG script), cache invalidation, permission checks per endpoint.

### Phase 4 — Shopping operations

Guest and authenticated cart (+ merge on login), wishlist, server-side pricing, coupons (concurrency-safe redemption), pincode serviceability, tax calculation (configurable), shipping quote, checkout quote, order creation with inventory reservation and expiry job.

Tests: cart maths, coupon limits under concurrency, no oversell under parallel checkouts, quote expiry, price-tamper attempts rejected.

### Phase 5 — Payments, shipping, order operations

`PaymentProvider` interface + Razorpay adapter (test mode), create/verify/webhook with raw-body signature check and event dedupe, reconciliation job, refund service, shipping adapter (+ manual fulfilment fallback), tracking sync, cancellations, returns, refunds, GST invoice generation (configurable).

Tests: signature forgery, replayed/duplicate webhooks, amount mismatch, out-of-order events, partial refunds, state-machine edges.

Live payments stay **disabled** until credentials exist and sandbox tests pass (gate G4).

### Phase 6 — Customer and business features

Profile and address book, order history, reviews with moderation, newsletter (double opt-in), notification service (email/SMS/WhatsApp adapters, retries, dedupe), support tickets, grievance workflow, consent records, DPDP access/correction/erasure requests, compliance matrix (`docs/COMPLIANCE_MATRIX.md`, flagged for legal/CA review).

### Phase 7 — AI and automation

Provider adapter, fixed read-only tools, guardrails, conversation + summary tables, usage limits and cost caps, admin AI settings, fallback to ordinary search. No live provider calls until a key is configured (gate G6).

### Phase 8 — Frontend integration

1. **First:** prove the TanStack Start build deploys on Vercel (Audit C1) in a throw-away project.
2. API client, auth flow, catalogue, cart/wishlist, checkout + Razorpay Checkout, account, orders, AI assistant.
3. Remove all demo content listed in Audit §4. Remove Lovable telemetry from production builds.
4. Self-host fonts, apply CSP.
5. Loading/empty/error states using existing visual language only.

Design preservation check: screenshot comparison of home, collection, product pages before/after.

### Phase 9 — Testing and hardening

Full unit/integration/e2e/security suites per the brief; concurrency and webhook tests; dependency and secret scans; OWASP verification pass (ASVS / API Top 10 mapping); backup **restore test**; fix all critical/high findings. Deliver `TESTING_REPORT.md` and `SECURITY_TEST_REPORT.md` with real results and unresolved items.

### Phase 10 — Staging and production readiness

Staging deployment (EC2 + Nginx + PM2 + Vercel), env validation, TLS, smoke tests, rollback rehearsal, monitoring, runbooks, `PRODUCTION_READINESS.md` checklist. **Production deployment only with your explicit approval.**

---

## 3. Open decisions (answers needed)

Defaults are what I will do if you do not say otherwise, *except* items marked **blocking**, which I will not assume.

| ID | Decision | Default / recommendation | Blocking? |
|---|---|---|---|
| D1 | GitHub repo URL, branch strategy, and whether `backend/` and `admin/` live in the same repo as the Lovable frontend | **Resolved:** `github.com/iaakash25/lli`; same repo, `backend/` and `admin/` as siblings of the frontend; feature branches + PRs into `main`; no force-push | — |
| D2 | Package manager | **Resolved: npm only** for frontend, backend and admin | — |
| D3 | Admin as a separate app on `admin.<domain>` | Yes | No |
| D4 | Production domain and subdomains (`www`, `api`, `admin`, staging pair) | — | **Yes** (cookies, CORS, CSP, TLS) |
| D5 | EC2 details: region, OS, size, access method; Nginx/PM2/Node already installed? | — | **Yes** (Phase 1 inventory) |
| D6 | PostgreSQL: version, same host or separate, existing data to preserve | Treated as containing important data until proven otherwise | **Yes** |
| D7 | Redis: installed? version? bound to localhost/private only? | — | **Yes** (Phase 2) |
| D8 | Guest checkout allowed? | Yes, email + phone, tokenised order lookup | No |
| D9 | Cash on delivery | Built but **off** until policy and fees are defined | No |
| D10 | Razorpay merchant account status | Build in test mode | **Yes** for go-live only |
| D11 | Shipping provider (Shiprocket?) and account status | Adapter + manual fulfilment | No |
| D12 | Email provider (Amazon SES suggested) and SMS provider (India requires DLT registration) | SES for email; SMS deferred | No |
| D13 | LLM provider and monthly cost cap | Adapter only; no live calls | No |
| D14 | GST: legal entity, GSTIN, HSN codes, rates, price-inclusive display, invoice format | Configuration only; **CA sign-off required** | **Yes** for launch |
| D15 | Return window, refund timelines, shipping fee policy, free-shipping threshold (₹2,500 is sample copy) | Placeholders flagged in UI copy | **Yes** for launch |
| D16 | Data retention periods (AI chats, inactive accounts, logs, backups) | AI chats 90 days; logs 30 days; to be confirmed with counsel | No |
| D17 | Proposed RPO/RTO | RPO ≤ 15 min, RTO ≤ 4 h | Needs your approval |
| D18 | Admin MFA method | TOTP first, WebAuthn later | No |
| D19 | Real product data: SKUs, variants, weights, HSN, images, cost prices | Current 22 products converted for development only | **Yes** for launch |

---

## 4. Approval gates (I will stop and ask)

| Gate | Trigger |
|---|---|
| G1 | Any change to an existing database, including the first migration, or any `DROP`/`TRUNCATE`/destructive statement |
| G2 | Any connection to the EC2 host, PostgreSQL or Redis (credentials or SSH are needed from you) |
| G3 | Adding any paid service or new infrastructure component |
| G4 | Enabling live payments, refunds or shipment booking against real accounts |
| G5 | Handling or storing any real credential or secret value |
| G6 | Enabling live AI provider calls |
| G7 | Any production deployment, DNS, or TLS change |
| G8 | Force-pushing, rebasing or otherwise rewriting pushed git history |

---

## 5. Assumptions recorded

- Node.js 24 LTS is the runtime (matches your development environment); EC2 will be checked against it before use.
- `Int` paise is sufficient for individual order and line amounts; reporting aggregates use `BigInt`.
- INR is the only currency in v1; schema keeps a `currency` column for later.
- Reservation hold time is 15 minutes (configurable).
- The existing storefront visual design is frozen.

---

## 6. Phase 0 exit checklist

- [x] Repository inspected (frontend only; no backend exists)
- [x] Quality baseline measured (tsc pass, 1/1 tests, 345 lint problems of which 337 formatting, 2 high advisories)
- [x] Audit, architecture, roadmap, security baseline written
- [ ] Infrastructure verified — **blocked on D5–D7**
- [ ] Open decisions answered — **blocked on D1, D4–D7, D10, D14, D15, D19 for the corresponding phases**
