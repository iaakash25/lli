# PostgreSQL 13 rehearsal report

Date: 2026-10-31. Goal: prove the Phase 1 migrations and database scripts on a real PostgreSQL 13 before anything is applied to the shared server.

## Environment

- **Server:** PostgreSQL 13.23 (Windows build from the `embedded-postgres` npm package, MIT), run from a temporary folder, listening on `127.0.0.1:54313` only. Production is 13.18 on Ubuntu 20.04, the same major version.
- **Isolation:** no connection was made to the shared server during the rehearsal. The server and its data folder were deleted afterwards; port 54313 was confirmed closed and no scratch `postgres` process remained. The machine's own PostgreSQL 18 service was not touched.
- **Settings matched to production where known:** `password_encryption=md5`, database named `LLI`. Not matched: operating system, TLS, `pg_hba.conf`, collation (the scratch server used the `C` locale).
- **Tools:** Prisma 7.10.1 (`migrate deploy`), `psql`/`pg_dump`/`pg_restore` 18 from the local install, Node `pg` driver.

## Results

| # | Check | Result |
|---|---|---|
| 1 | `prisma migrate deploy` on an empty `LLI` | Both migrations applied; 2 rows in `_prisma_migrations`, both finished |
| 2 | Objects created | 49 tables + Prisma's table, 20 enums, `pg_trgm` 1.5, 35 CHECKs, 54 foreign keys, 9 triggers, 2 helper functions, generated `search_vector`, 138 indexes, no `updated_at` without a default |
| 3 | Failed-migration drill | **Problem found** (below). Fixed; with the fix a mid-file error leaves no partial changes |
| 4 | Reference seed and dev catalogue seed, each run twice | Identical counts on re-run (28 permissions, 7 roles, 83 role-permissions, 22 products, 72 variants, 70 ledger rows, 13 categories, 8 collections, 96 collection products); dev guard blocks the run without the opt-in |
| 5 | `roles_and_grants.sql` through real `psql` with variables | Runs cleanly; refuses when connected to a database other than `LLI` |
| 6 | Privileges checked over each role's own connection | `lli_app` can read and insert audit rows but cannot update, delete or truncate the 4 append-only tables, cannot create or drop tables; `lli_readonly` cannot read users, sessions, tokens, MFA, addresses, consents, AI messages or idempotency keys and is read-only by default; `lli_migrator` owns all tables and functions; default privileges cover new tables; a role with no grants cannot connect to `LLI`; even the table owner cannot delete append-only rows; per-role timeouts applied |
| 7 | Concurrency (50 connections) | 120 buyers for 25 units: exactly 25 succeed, `reserved` never above `on_hand`; the CHECK rejects an unguarded over-reserve; 40 duplicate webhook deliveries: 1 accepted; 30 concurrent signups with one email: 1 account; 20 concurrent default addresses: 1; illegal order jumps rejected under contention |
| 8 | Dump and restore | 50 tables, 608 rows, 0 mismatches; schema identical; 9 triggers present; append-only still enforced; search works after restore. **Problem found** (below) |
| 9 | Rollback and redeploy | Refuses with data present; with the opt-in leaves only `_prisma_migrations`; redeploy then applies both migrations again. **Problem found** (below) |
| 10 | Repo test suite on this server (`TEST_DATABASE_URL`) | 34 tests: 33 pass, 1 skipped on purpose (the roles test, because roles are cluster-wide; covered by checks 5 and 6). No test databases left behind |
| 11 | In-memory suite after the fixes | 34 of 34 pass |

## Problems found, and what was done

1. **A failed migration was not atomic.** Prisma runs a migration file without a transaction: a deliberately broken file left its earlier statements applied. Both migrations are now wrapped in `BEGIN; … COMMIT;` and a test requires it. This corrects an unproven claim in the earlier plan.
2. **The rollback script left Prisma's bookkeeping behind.** After a rollback, `migrate deploy` said "No pending migrations" and the database stayed empty. The script now deletes the two migration rows, and a test covers it. The rollback script itself is also wrapped in a transaction.
3. **`pg_dump` 18 archives cannot be restored into PostgreSQL 13.** The archive begins with `SET transaction_timeout`, which 13 rejects. For the drill the unsupported line was stripped; for the real backup, use a PostgreSQL 13 client, ideally `pg_dump` on the server itself. The plan now says so.
4. **The apply order in the plan was wrong.** `roles_and_grants.sql` needs the tables to exist (it moves ownership and revokes on specific tables), so the first migration must run before it, using a one-time privileged login. The plan is corrected.

One setup trap, not a code bug: roles created under `md5` password storage cannot log in if `pg_hba.conf` requires `scram-sha-256`. Production stores `md5`; check which method its `pg_hba.conf` uses for the app host before the roles step.

## Not covered

- The production server itself: Ubuntu build, its TLS, `pg_hba.conf`, collation and encoding, and 13.18 versus 13.23 (same major; minor-release differences untested).
- Behaviour with real data volumes; the seed data is tiny.
- The roles script's idempotence: it is run-once by design and fails if the roles already exist.

## Changes made in this branch

- `backend/prisma/migrations/*`: wrapped in transactions.
- `backend/db/rollback_0001_0002.sql`: transaction, clears bookkeeping rows.
- `backend/test/helpers/db.mjs`: adapter so the same tests run on pglite or a real server; `pg` added as a dev dependency.
- `backend/rehearsal/`: the repeatable checks and a README to set up a throwaway server.
- Docs: migration plan rewritten with the corrected order and rollback steps.
