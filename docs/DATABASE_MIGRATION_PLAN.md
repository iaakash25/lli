# Database migration and rollback plan (Phase 1)

**Status: rehearsed on a real PostgreSQL 13.23 (local, throwaway). Nothing has been applied to the shared LLI database.** Applying anything needs your explicit approval (gate G1). Rehearsal results: [DATABASE_REHEARSAL_REPORT.md](DATABASE_REHEARSAL_REPORT.md).

## Scope rule

All changes stay inside the **LLI database's `public` schema**. The server is shared with six other production databases; none of their data is read or changed. The single step that is not database-local is creating three new `lli_*` login roles, because PostgreSQL roles are cluster-wide. That step is isolated in `backend/db/roles_and_grants.sql` and needs its own approval.

## What exists today (read-only inventory, 2026-10-31)

PostgreSQL 13.18 (Ubuntu 20.04), TLS on, `listen_addresses='*'`, `password_encryption=md5`. Database `LLI` is **empty**: only the `public` schema, no tables, no extensions besides `plpgsql`, no `_prisma_migrations`. The login used for the inventory is a superuser and must not be used by the application.

Still unchecked on the server (read-only query, no change): the `LLI` database's encoding and collation, and the `pg_hba.conf` authentication method for the app host (`md5` vs `scram-sha-256`).

## Files

| File | Purpose | Applied by |
|---|---|---|
| `backend/prisma/migrations/0001_init/migration.sql` | 49 tables, 20 enums, keys, indexes. Generated offline by `prisma migrate diff` from `schema.prisma`, wrapped in `BEGIN; … COMMIT;`. | `prisma migrate deploy` |
| `backend/prisma/migrations/0002_constraints/migration.sql` | `pg_trgm`, CHECKs, partial unique indexes, search column, append-only and state-machine triggers, `updated_at` defaults. Wrapped in `BEGIN; … COMMIT;`. | `prisma migrate deploy` |
| `backend/db/roles_and_grants.sql` | Roles `lli_migrator`, `lli_app`, `lli_readonly`; moves ownership to `lli_migrator`; revokes `PUBLIC`; table grants; append-only revokes. Run once; **requires the tables to exist**. | By hand, once, as superuser (separate approval) |
| `backend/db/seed/reference_data.sql` | 28 permissions, 7 roles and their mapping, inactive GST placeholders. No users or passwords. | By hand or seed step, idempotent |
| `backend/db/seed/dev_catalogue.sql` | **Development only.** The storefront's 22 products as 72 variants with paise prices, placeholder stock and media keys, 13 categories and 8 collections. Refuses to run unless the session sets `lli.allow_dev_seed = 'on'`. | By hand, on development databases only |
| `backend/db/rollback_0001_0002.sql` | Drops everything the migrations created and clears their `_prisma_migrations` rows. Guarded (database must be `LLI`; refuses if business tables hold rows). | By hand, only if needed |
| `backend/rehearsal/` | Repeatable checks for a throwaway PostgreSQL (objects, roles, concurrency). Refuse any non-loopback host. | Rehearsals only |

## Verification done (no shared database touched)

1. **In-memory PostgreSQL 17 (pglite):** `npm test` in `backend/` runs 34 checks.
2. **Real PostgreSQL 13.23, local throwaway server:** the same suite with `TEST_DATABASE_URL` (33 pass, 1 skipped on purpose), plus `prisma migrate deploy`, both seeds twice, the real `psql` run of `roles_and_grants.sql`, per-role privilege checks over each role's own connection, 120-way concurrent stock reservation, duplicate-webhook / signup / default-address races, a dump-and-restore drill, a deliberate failed-migration drill, and a rollback-and-redeploy cycle. Details and the four problems it found: [DATABASE_REHEARSAL_REPORT.md](DATABASE_REHEARSAL_REPORT.md).

**Still not verified:** the production server itself (13.18 on Ubuntu; the rehearsal ran 13.23 on Windows), its TLS and `pg_hba.conf` behaviour, and its collation.

## Apply procedure (requires your go-ahead)

1. **Read-only checks on the server:** `LLI` encoding and collation, `pg_hba.conf` method for the app host, free disk, and that `archive_mode`/WAL archiving is healthy.
2. **Backup first.** Take `pg_dump -Fc` of `LLI` **using a PostgreSQL 13 client, ideally `pg_dump` on the server itself** (a version 17/18 client writes `SET transaction_timeout`, which 13 rejects on restore). Record the checksum and restore it into a scratch database to prove it works.
3. **Apply the migrations** with `prisma migrate deploy` over TLS (SSH tunnel or allow-listed IP), `DATABASE_URL` in the environment only, never in the repository. This first apply needs a login that can create objects in `LLI`; use the existing privileged login once, temporarily.
4. **Create roles and grants** (separate approval): run `roles_and_grants.sql` with passwords supplied from a password manager at run time. It moves ownership to `lli_migrator`.
5. **Seed** `reference_data.sql`. Do **not** run `dev_catalogue.sql` against production data.
6. **Verify** with `backend/rehearsal/verify-objects.mjs` and `verify-roles.mjs` adapted for the server (read-only parts only; do not run `concurrency.mjs` there): 49 tables, 20 enums, 9 triggers, `lli_app` cannot update or delete the append-only tables, `lli_readonly` cannot read credential or personal-data tables.
7. **Switch** all later migrations to `lli_migrator`, and the application to `lli_app`. The privileged login is not used again.
8. **Record** the result in this document.

## Rollback

| Situation | Action |
|---|---|
| A migration fails midway | The files are wrapped in `BEGIN; … COMMIT;`, so a failure leaves nothing from that file behind (proved on PostgreSQL 13.23; without the wrapper Prisma leaves earlier statements applied). Prisma then marks the migration failed: fix the cause, run `prisma migrate resolve --rolled-back <migration_name>`, then `prisma migrate deploy` again. |
| Applied but unwanted, no real data yet | `backend/db/rollback_0001_0002.sql`. It also clears the two `_prisma_migrations` rows so `migrate deploy` re-applies cleanly (proved in the rehearsal). |
| Applied and real data exists | Restore the pre-migration backup; do not use the rollback script. After go-live, schema changes are forward-only migrations. |

## After the apply (recommended, outside Phase 1 scope)

- Rotate the password of the login used for the inventory (it has appeared in chat several times).
- Close public access to port 5432 in the security group; allow only the app server and a tunnel/VPN.
- Plan a move from `md5` to `scram-sha-256` password storage with the owners of the other databases. Until then, roles created on that server get `md5` hashes, which only work if `pg_hba.conf` uses `md5` for the app host.
- Configure application connections with `sslmode=verify-full` and the server's CA.
