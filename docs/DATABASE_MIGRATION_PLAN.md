# Database migration and rollback plan (Phase 1)

**Status: drafted, tested on an in-memory database only. Nothing has been applied to the LLI database.** Applying anything needs your explicit approval (gate G1).

## Scope rule

All changes stay inside the **LLI database's `public` schema**. The server is shared with six other production databases; none of their data is read or changed. The single step that is not database-local is creating three new `lli_*` login roles, because PostgreSQL roles are cluster-wide. That step is isolated in `backend/db/roles_and_grants.sql` and needs its own approval.

## What exists today (read-only inventory, 2026-10-31)

PostgreSQL 13.18 (Ubuntu 20.04), TLS on, `listen_addresses='*'`, `password_encryption=md5`. Database `LLI` is **empty**: only the `public` schema, no tables, no extensions besides `plpgsql`, no `_prisma_migrations`. The login used for the inventory is a superuser and must not be used by the application.

## Files

| File | Purpose | Applied by |
|---|---|---|
| `backend/prisma/migrations/0001_init/migration.sql` | 49 tables, 20 enums, keys, indexes. Generated offline by `prisma migrate diff` from `schema.prisma`. | `prisma migrate deploy` |
| `backend/prisma/migrations/0002_constraints/migration.sql` | `pg_trgm`, CHECKs, partial unique indexes, search column, append-only and state-machine triggers, `updated_at` defaults. | `prisma migrate deploy` |
| `backend/db/roles_and_grants.sql` | Roles `lli_migrator`, `lli_app`, `lli_readonly`; revokes `PUBLIC`; table grants; append-only revokes. | By hand, once, as superuser (separate approval) |
| `backend/db/seed/reference_data.sql` | 28 permissions, 7 roles and their mapping, inactive GST placeholders. No users or passwords. | By hand or seed step, idempotent |
| `backend/db/seed/dev_catalogue.sql` | **Development only.** The storefront's 22 products as 72 variants (colour × size) with paise prices, placeholder stock and media keys, 13 categories and 8 collections. Generated from `src/lib/catalog.ts` by `npm run seed:dev:generate`; refuses to run unless the session sets `lli.allow_dev_seed = 'on'`. Not for production data. | By hand, on development databases only |
| `backend/db/rollback_0001_0002.sql` | Drops everything the migrations created. | By hand, only if needed |

## Verification already done (no database touched)

`npm test` in `backend/` applies the migrations to an in-memory PostgreSQL 17 (pglite) and runs 32 checks (23 on the schema, 9 on the dev catalogue seed, which must match the storefront's products, prices, stock labels and collection membership): negative stock and over-reservation rejected, atomic reservation, unique SKU/slug/email/webhook event/payment ids, one captured payment per order, legal and illegal order transitions, append-only tables, coupon and rating rules, search vector and trigram search, seed idempotence, role privileges, and the rollback script (refuses with data, leaves nothing behind, re-applies cleanly).

**Not verified:** the migrations have not run on PostgreSQL 13 (production's version; pglite is 17). Features used exist in 13, but a rehearsal on a real PG13 copy is part of the plan below. The `psql` variable handling at the top of `roles_and_grants.sql` and the database-level `GRANT`/`REVOKE`/`ALTER ROLE … IN DATABASE` lines were excluded from the in-memory test.

## Proposed apply procedure (requires your go-ahead)

1. **Backup first.** `pg_dump -Fc` of `LLI` (it is empty, so this is seconds) plus confirm the server's existing physical backup/WAL archiving (`archive_mode=on`) is healthy. Record the backup's checksum and restore it into a scratch database to prove it works.
2. **Rehearse on PG13.** Apply `0001` and `0002` to a scratch database (a throwaway local PG13, or a temporary database you approve), run the checks, then run the rollback script and apply again.
3. **Create roles** (separate approval): `roles_and_grants.sql` with passwords supplied from your password manager at run time.
4. **Apply** `prisma migrate deploy` to `LLI` as `lli_migrator` over TLS, from the host or an SSH tunnel, with `DATABASE_URL` in the environment (never in the repository).
5. **Seed** `reference_data.sql`.
6. **Verify** table count (49), enums (20), constraints, trigger presence, and that `lli_app` cannot `UPDATE`/`DELETE` the append-only tables.
7. **Record** the result in this document.

## Rollback

| Situation | Action |
|---|---|
| Migration fails midway | Each file is sent as one multi-statement script, which PostgreSQL runs as a single implicit transaction, so a failure should leave the schema unchanged (to be confirmed in the PG13 rehearsal). Fix and re-run. |
| Applied but unwanted, no real data yet | `backend/db/rollback_0001_0002.sql` (guarded: database must be `LLI`, and it refuses if business tables hold rows). |
| Applied and real data exists | Restore the pre-migration backup; do not use the rollback script. After go-live, schema changes are forward-only migrations. |

## After the apply (recommended, outside Phase 1 scope)

- Rotate the password of the login used for the inventory (it has appeared in chat several times).
- Close public access to port 5432 in the security group; allow only the app server and a tunnel/VPN.
- Plan a move from `md5` to `scram-sha-256` password storage with the owners of the other databases.
- Configure application connections with `sslmode=verify-full` and the server's CA.
