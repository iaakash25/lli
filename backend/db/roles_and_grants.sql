-- Least-privilege database roles and grants for the LLI database.
--
-- NOT a migration and NOT applied automatically. Run it once, by hand, after the migrations, as a
-- superuser connected to the LLI database, and only after explicit approval (roadmap gate G1).
--
-- Scope note: CREATE ROLE is cluster-wide in PostgreSQL (roles are shared by every database on the
-- server). The three roles created here are new, lli_-prefixed and have no access to any other
-- database, but creating them is the one step that is not confined to the LLI database itself.
-- Everything else in this file (REVOKE/GRANT/ALTER DEFAULT PRIVILEGES/role settings) applies to the
-- LLI database only.
--
--   psql "host=... dbname=LLI user=<superuser> sslmode=require" \
--        -v ON_ERROR_STOP=1 \
--        -v migrator_password="$LLI_MIGRATOR_PASSWORD" \
--        -v app_password="$LLI_APP_PASSWORD" \
--        -v readonly_password="$LLI_READONLY_PASSWORD" \
--        -f backend/db/roles_and_grants.sql
--
-- Passwords are supplied at run time and never stored in this repository.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'LLI' THEN
    RAISE EXCEPTION 'refusing to run: connected to database %, expected LLI', current_database();
  END IF;
END;
$$;

-- ── Roles ────────────────────────────────────────────────────────────────────────────────────
-- lli_migrator: owns and alters schema objects; used only by the migration step.
-- lli_app:      the API's runtime login; data access only, no DDL.
-- lli_readonly: reporting; no access to credentials, sessions or personal-data tables.

CREATE ROLE lli_migrator LOGIN PASSWORD :'migrator_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5;
CREATE ROLE lli_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 50;
CREATE ROLE lli_readonly LOGIN PASSWORD :'readonly_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5;

-- Per-role, per-database settings (apply to LLI only).
ALTER ROLE lli_app IN DATABASE "LLI" SET statement_timeout = '15s';
ALTER ROLE lli_app IN DATABASE "LLI" SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE lli_app IN DATABASE "LLI" SET lock_timeout = '5s';
ALTER ROLE lli_readonly IN DATABASE "LLI" SET statement_timeout = '30s';
ALTER ROLE lli_readonly IN DATABASE "LLI" SET default_transaction_read_only = on;

-- ── Database and schema access ───────────────────────────────────────────────────────────────

REVOKE ALL ON DATABASE "LLI" FROM PUBLIC;
GRANT CONNECT ON DATABASE "LLI" TO lli_migrator, lli_app, lli_readonly;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO lli_migrator;
GRANT USAGE ON SCHEMA public TO lli_app, lli_readonly;

-- Hand ownership of everything the migrations created to lli_migrator.
DO $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO lli_migrator', obj.name);
  END LOOP;
  FOR obj IN
    SELECT format('%I.%I', n.nspname, t.typname) AS name
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype = 'e'
  LOOP
    EXECUTE format('ALTER TYPE %s OWNER TO lli_migrator', obj.name);
  END LOOP;
  FOR obj IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS name
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'lli\_%'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO lli_migrator', obj.name);
  END LOOP;
END;
$$;

-- ── Table privileges ─────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lli_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lli_readonly;

-- Tables created by future migrations get the same grants.
ALTER DEFAULT PRIVILEGES FOR ROLE lli_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lli_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lli_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO lli_readonly;

-- Append-only tables: the app may add and read rows, never change or remove them.
REVOKE UPDATE, DELETE, TRUNCATE ON
  admin_audit_logs, security_events, inventory_movements, order_status_history
FROM lli_app;

-- Reporting must not see credentials, sessions or personal-data tables.
REVOKE ALL ON
  users, sessions, one_time_tokens, mfa_credentials, addresses, consents,
  ai_conversations, ai_messages, notification_logs, idempotency_keys
FROM lli_readonly;

-- Nobody but the migrator may change the schema.
REVOKE CREATE ON SCHEMA public FROM lli_app, lli_readonly;
