import { connect, one } from "./lib.mjs";
const c = await connect();
const r = async (label, sql) => console.log(label.padEnd(34), JSON.stringify(await one(c, sql)));
await r("version", "select current_setting('server_version') v");
await r(
  "tables (public, base)",
  "select count(*)::int n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
);
await r(
  "enums",
  "select count(*)::int n from pg_type t join pg_namespace s on s.oid=t.typnamespace where s.nspname='public' and t.typtype='e'",
);
await r("extension pg_trgm", "select extversion v from pg_extension where extname='pg_trgm'");
await r(
  "check constraints",
  "select count(*)::int n from pg_constraint c join pg_namespace s on s.oid=c.connamespace where s.nspname='public' and c.contype='c'",
);
await r(
  "foreign keys",
  "select count(*)::int n from pg_constraint c join pg_namespace s on s.oid=c.connamespace where s.nspname='public' and c.contype='f'",
);
await r(
  "user triggers",
  "select count(*)::int n from pg_trigger t join pg_class k on k.oid=t.tgrelid join pg_namespace s on s.oid=k.relnamespace where s.nspname='public' and not t.tgisinternal",
);
await r(
  "lli_ functions",
  "select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname like 'lli\_%'",
);
await r(
  "generated col products.search_vector",
  "select attgenerated g from pg_attribute where attrelid='public.products'::regclass and attname='search_vector'",
);
await r("indexes", "select count(*)::int n from pg_indexes where schemaname='public'");
await r(
  "updated_at without default",
  "select count(*)::int n from information_schema.columns where table_schema='public' and column_name='updated_at' and column_default is null",
);
await r(
  "_prisma_migrations",
  "select count(*)::int n, count(finished_at)::int finished, count(rolled_back_at)::int rolled_back, string_agg(migration_name, ',' order by migration_name) as migration_names from _prisma_migrations",
);
await c.end();
