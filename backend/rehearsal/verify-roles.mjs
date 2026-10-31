import { connect, rolePasswords } from "./lib.mjs";
const { migrator: mp, app: ap, readonly: rp } = rolePasswords();
let fails = 0;
const ok = (label, cond) => {
  console.log((cond ? "PASS " : "FAIL ") + label);
  if (!cond) fails++;
};
const denied = async (c, sql, label) => {
  try {
    await c.query(sql);
    ok(label + " (expected denial, but it worked)", false);
  } catch (e) {
    ok(
      `${label} -> ${e.message.slice(0, 60)}`,
      /permission denied|must be owner|read-only transaction|append-only/.test(e.message),
    );
    await c.query("ROLLBACK").catch(() => {});
  }
};
const works = async (c, sql, label) => {
  try {
    await c.query(sql);
    ok(label, true);
  } catch (e) {
    ok(`${label} -> ${e.message}`, false);
    await c.query("ROLLBACK").catch(() => {});
  }
};

const app = await connect("LLI", "lli_app", ap);
await works(app, "select count(*) from users", "app can read users");
await works(
  app,
  "insert into admin_audit_logs (action, entity_type) values ('rehearsal.test','test')",
  "app can insert audit rows",
);
await denied(app, "update admin_audit_logs set action='x'", "app cannot update audit rows");
await denied(app, "delete from admin_audit_logs", "app cannot delete audit rows");
await denied(app, "truncate admin_audit_logs", "app cannot truncate audit rows");
await denied(app, "update inventory_movements set note='x'", "app cannot update stock ledger");
await denied(app, "update order_status_history set reason='x'", "app cannot update order history");
await denied(app, "create table app_ddl_probe (id int)", "app cannot create tables");
await denied(app, "drop table users", "app cannot drop tables");
await works(app, "update products set rank = rank where false", "app can update products");
console.log(
  "   app statement_timeout =",
  (await app.query("show statement_timeout")).rows[0].statement_timeout,
  "| lock_timeout =",
  (await app.query("show lock_timeout")).rows[0].lock_timeout,
  "| idle_in_tx =",
  (await app.query("show idle_in_transaction_session_timeout")).rows[0]
    .idle_in_transaction_session_timeout,
);
ok(
  "app timeouts applied",
  (await app.query("show statement_timeout")).rows[0].statement_timeout === "15s",
);
await app.end();

const ro = await connect("LLI", "lli_readonly", rp);
await works(ro, "select count(*) from products", "readonly can read products");
for (const t of [
  "users",
  "sessions",
  "one_time_tokens",
  "mfa_credentials",
  "addresses",
  "consents",
  "ai_messages",
  "idempotency_keys",
])
  await denied(ro, `select 1 from ${t} limit 1`, `readonly cannot read ${t}`);
await denied(
  ro,
  "insert into site_settings (key, value) values ('k','1')",
  "readonly cannot write",
);
ok(
  "readonly is read-only by default",
  (await ro.query("show default_transaction_read_only")).rows[0].default_transaction_read_only ===
    "on",
);
await ro.end();

const mig = await connect("LLI", "lli_migrator", mp);
await works(mig, "create table migrator_probe (id int)", "migrator can create tables");
const app2 = await connect("LLI", "lli_app", ap);
await works(
  app2,
  "insert into migrator_probe values (1)",
  "default privileges give app DML on new tables",
);
await app2.end();
const ro2 = await connect("LLI", "lli_readonly", rp);
await works(
  ro2,
  "select * from migrator_probe",
  "default privileges give readonly SELECT on new tables",
);
await denied(ro2, "insert into migrator_probe values (2)", "readonly cannot write new tables");
await ro2.end();
await mig.query("drop table migrator_probe");
const owners = (
  await mig.query(
    "select distinct pg_get_userbyid(relowner) o from pg_class where relnamespace='public'::regnamespace and relkind='r'",
  )
).rows.map((r) => r.o);
ok(
  `all tables owned by lli_migrator (${owners.join(",")})`,
  owners.length === 1 && owners[0] === "lli_migrator",
);
const fo = (
  await mig.query(
    "select distinct pg_get_userbyid(proowner) o from pg_proc where pronamespace='public'::regnamespace and proname like 'lli\_%'",
  )
).rows.map((r) => r.o);
ok(
  `helper functions owned by lli_migrator (${fo.join(",")})`,
  fo.length === 1 && fo[0] === "lli_migrator",
);
// Owner is still bound by the append-only triggers.
await denied(
  mig,
  "delete from admin_audit_logs",
  "even the table owner cannot delete append-only rows (row exists)",
);
await mig.end();

// A role with no grants must not be able to connect to LLI (CONNECT revoked from PUBLIC).
const admin = await connect("postgres");
await admin.query("create role lli_probe login password 'probe-pw' nosuperuser");
try {
  const p = await connect("LLI", "lli_probe", "probe-pw");
  await p.end();
  ok("ungranted role cannot connect to LLI", false);
} catch (e) {
  ok(
    `ungranted role cannot connect to LLI -> ${e.message.slice(0, 50)}`,
    /permission denied/.test(e.message),
  );
}
await admin.query("drop role lli_probe");
await admin.end();
console.log(fails ? `\n${fails} FAILED` : "\nall role checks passed");
process.exit(fails ? 1 : 0);
