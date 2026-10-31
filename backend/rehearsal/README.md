# PostgreSQL rehearsal

Repeatable checks that run the migrations and database scripts on a **real PostgreSQL 13** before anything is applied to the shared server. Results of the last run: [docs/DATABASE_REHEARSAL_REPORT.md](../../docs/DATABASE_REHEARSAL_REPORT.md).

**Throwaway server only.** These scripts create and drop databases, roles and rows. `lib.mjs` refuses any host that is not a loopback address. Never run them against the shared server.

## Set up a throwaway PostgreSQL 13 (Windows, no Docker)

Install the binaries outside the repository, without install scripts:

```bash
mkdir pg13 && cd pg13 && npm init -y
npm install --save-exact --ignore-scripts embedded-postgres@13.23.0-beta.16 @embedded-postgres/windows-x64@13.23.0-beta.16
BIN=node_modules/@embedded-postgres/windows-x64/native/bin
printf '%s' "$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")" > pgpass.txt
$BIN/initdb.exe -D data -U rehearsal --pwfile=pgpass.txt -A scram-sha-256 -E UTF8 --locale=C
$BIN/pg_ctl.exe -D data -l server.log -o "-p 54313 -c listen_addresses=127.0.0.1 -c password_encryption=md5" start
```

The server listens on `127.0.0.1:54313` only. Production uses `md5` password storage, so change the two `host … scram-sha-256` lines for `127.0.0.1` and `::1` in `data/pg_hba.conf` to `md5` and run `pg_ctl reload`, or role logins will fail. Use PostgreSQL 13 client tools for dumps (`pg_dump` 18 writes `SET transaction_timeout`, which 13 rejects).

## Run

```bash
export REHEARSAL_PASSWORD="$(cat pgpass.txt)"
# create the LLI database, then from backend/:
DATABASE_URL="postgresql://rehearsal:$REHEARSAL_PASSWORD@127.0.0.1:54313/LLI" npx prisma migrate deploy
psql … -f db/seed/reference_data.sql
psql … -c "SET lli.allow_dev_seed = 'on'" -f db/seed/dev_catalogue.sql
psql … -v migrator_password=… -v app_password=… -v readonly_password=… -f db/roles_and_grants.sql
export REHEARSAL_ROLE_PASSWORDS="migrator,app,readonly"
node rehearsal/verify-objects.mjs
node rehearsal/verify-roles.mjs
node rehearsal/concurrency.mjs
```

The unit tests can run on the same server: `TEST_DATABASE_URL=postgresql://rehearsal:…@127.0.0.1:54313/postgres npm test` (each test file creates and drops its own database).

## Tear down

`pg_ctl -D data stop`, then delete the `pg13` folder (it holds the data directory and passwords).
