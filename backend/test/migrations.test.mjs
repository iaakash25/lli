// Applies every migration to an in-memory PostgreSQL (pglite) and checks the database-level
// guarantees. No network access and no connection to any real database.
//
// Note: pglite runs PostgreSQL 17; production is PostgreSQL 13. Everything used by the migrations
// (generated columns, gen_random_uuid, pg_trgm, plpgsql triggers) exists in 13, but the full
// migration set must still be rehearsed on a PG13 database before it is applied for real.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "prisma", "migrations");
const migrationNames = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

let db;

const rejects = (sql, pattern, params) =>
  assert.rejects(() => db.query(sql, params), pattern, `expected rejection: ${sql.slice(0, 80)}`);

const id = async (sql, params) => (await db.query(`${sql} RETURNING id`, params)).rows[0].id;

const newVariant = async (sku, stock = 10) => {
  const product = await id(
    `INSERT INTO products (slug, name, product_type, status) VALUES ($1, $2, 'wallet', 'ACTIVE')`,
    [`p-${sku}`, `Product ${sku}`],
  );
  const variant = await id(
    `INSERT INTO product_variants (product_id, sku, price_paise) VALUES ($1, $2, 250000)`,
    [product, sku],
  );
  await db.query(`INSERT INTO inventory (variant_id, on_hand) VALUES ($1, $2)`, [variant, stock]);
  return variant;
};

const newOrder = async (num, status = "PENDING_PAYMENT") =>
  id(
    `INSERT INTO orders (order_number, guest_email, status, payment_method, subtotal_paise, total_paise, shipping_address)
     VALUES ($1, 'guest@example.com', $2, 'ONLINE', 100000, 100000, '{}')`,
    [num, status],
  );

before(async () => {
  db = new PGlite({ extensions: { pg_trgm } });
  for (const name of migrationNames) {
    await db.exec(readFileSync(join(migrationsDir, name, "migration.sql"), "utf8"));
  }
});

describe("migrations", () => {
  it("are present and ordered", () => {
    assert.deepEqual(migrationNames, ["0001_init", "0002_constraints"]);
  });

  it("create the expected number of tables", async () => {
    const r = await db.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    assert.equal(r.rows[0].n, 49);
  });
});

describe("inventory", () => {
  it("rejects negative stock and reserved > on_hand", async () => {
    const v = await newVariant("INV-1", 5);
    await rejects(
      `UPDATE inventory SET on_hand = -1 WHERE variant_id = $1`,
      /inventory_stock_chk/,
      [v],
    );
    await rejects(
      `UPDATE inventory SET reserved = 6 WHERE variant_id = $1`,
      /inventory_stock_chk/,
      [v],
    );
  });

  it("atomic reservation succeeds only while stock remains", async () => {
    const v = await newVariant("INV-2", 3);
    const reserve = (qty) =>
      db.query(
        `UPDATE inventory SET reserved = reserved + $2 WHERE variant_id = $1 AND (on_hand - reserved) >= $2`,
        [v, qty],
      );
    assert.equal((await reserve(2)).affectedRows, 1);
    assert.equal((await reserve(2)).affectedRows, 0); // only 1 left
    assert.equal((await reserve(1)).affectedRows, 1);
    assert.equal((await reserve(1)).affectedRows, 0);
  });

  it("rejects non-positive reservation quantity", async () => {
    const v = await newVariant("INV-3");
    await rejects(
      `INSERT INTO inventory_reservations (variant_id, quantity, expires_at) VALUES ($1, 0, now())`,
      /reservations_quantity_chk/,
      [v],
    );
  });
});

describe("catalogue", () => {
  it("rejects negative price and compare-at below price", async () => {
    const p = await id(
      `INSERT INTO products (slug, name, product_type) VALUES ('cat-1', 'Cat 1', 'tote')`,
    );
    await rejects(
      `INSERT INTO product_variants (product_id, sku, price_paise) VALUES ($1, 'CAT-1', -1)`,
      /variants_price_chk/,
      [p],
    );
    await rejects(
      `INSERT INTO product_variants (product_id, sku, price_paise, compare_at_paise) VALUES ($1, 'CAT-2', 1000, 900)`,
      /variants_compare_at_chk/,
      [p],
    );
  });

  it("enforces unique SKU and slug", async () => {
    await newVariant("DUP-1");
    await rejects(
      `INSERT INTO products (slug, name, product_type) VALUES ('p-DUP-1', 'x', 'y')`,
      /products_slug_key/,
    );
    const p = await id(
      `INSERT INTO products (slug, name, product_type) VALUES ('dup-other', 'x', 'y')`,
    );
    await rejects(
      `INSERT INTO product_variants (product_id, sku, price_paise) VALUES ($1, 'DUP-1', 100)`,
      /product_variants_sku_key/,
      [p],
    );
  });

  it("populates the search vector and supports trigram search", async () => {
    await db.query(
      `INSERT INTO products (slug, name, tagline, product_type, material)
       VALUES ('search-1', 'Oxblood Cardholder', 'Slim everyday carry', 'cardholder', 'Full-grain leather')`,
    );
    const fts = await db.query(
      `SELECT slug FROM products WHERE search_vector @@ plainto_tsquery('simple', 'cardholder')`,
    );
    assert.deepEqual(
      fts.rows.map((r) => r.slug),
      ["search-1"],
    );
    const trgm = await db.query(
      `SELECT slug FROM products WHERE name % 'Oxblod Cardholdr' ORDER BY slug`,
    );
    assert.ok(trgm.rows.some((r) => r.slug === "search-1"));
  });
});

describe("identity", () => {
  it("keeps emails unique case-insensitively via the normalised column", async () => {
    await db.query(
      `INSERT INTO users (email, email_normalized) VALUES ('A@Example.com', 'a@example.com')`,
    );
    await rejects(
      `INSERT INTO users (email, email_normalized) VALUES ('a@example.com', 'a@example.com')`,
      /users_email_normalized_key/,
    );
    await rejects(
      `INSERT INTO users (email, email_normalized) VALUES ('B@Example.com', 'B@Example.com')`,
      /users_email_normalized_chk/,
    );
  });

  it("allows only one default address per user and validates Indian PIN codes", async () => {
    const u = await id(
      `INSERT INTO users (email, email_normalized) VALUES ('addr@example.com', 'addr@example.com')`,
    );
    const addr = (pin, def) =>
      db.query(
        `INSERT INTO addresses (user_id, full_name, phone, line1, city, state, state_code, postal_code, is_default)
         VALUES ($1, 'N', '9999999999', 'L1', 'Delhi', 'Delhi', '07', $2, $3)`,
        [u, pin, def],
      );
    await addr("110001", true);
    await addr("110002", false);
    await assert.rejects(() => addr("110003", true), /addresses_one_default_per_user/);
    await assert.rejects(() => addr("011000", false), /addresses_postal_code_chk/);
  });

  it("allows one active cart per user", async () => {
    const u = await id(
      `INSERT INTO users (email, email_normalized) VALUES ('cart@example.com', 'cart@example.com')`,
    );
    await db.query(`INSERT INTO carts (user_id) VALUES ($1)`, [u]);
    await rejects(`INSERT INTO carts (user_id) VALUES ($1)`, /carts_one_active_per_user/, [u]);
    await rejects(`INSERT INTO carts (status) VALUES ('ACTIVE')`, /carts_owner_chk/);
  });
});

describe("orders and payments", () => {
  it("rejects negative amounts and ownerless orders", async () => {
    await rejects(
      `INSERT INTO orders (order_number, guest_email, payment_method, subtotal_paise, total_paise, shipping_address)
       VALUES ('LLI-NEG', 'g@example.com', 'ONLINE', -1, 0, '{}')`,
      /orders_amounts_chk/,
    );
    await rejects(
      `INSERT INTO orders (order_number, payment_method, subtotal_paise, total_paise, shipping_address)
       VALUES ('LLI-NOOWN', 'ONLINE', 100, 100, '{}')`,
      /orders_owner_chk/,
    );
  });

  it("allows legal status transitions and rejects illegal ones", async () => {
    const o = await newOrder("LLI-T1");
    await db.query(`UPDATE orders SET status = 'CONFIRMED' WHERE id = $1`, [o]);
    await db.query(`UPDATE orders SET status = 'PROCESSING' WHERE id = $1`, [o]);
    await rejects(
      `UPDATE orders SET status = 'DELIVERED' WHERE id = $1`,
      /illegal order status transition/,
      [o],
    );
    await rejects(
      `UPDATE orders SET status = 'PENDING_PAYMENT' WHERE id = $1`,
      /illegal order status transition/,
      [o],
    );
    const done = await newOrder("LLI-T2", "DELIVERED");
    await rejects(
      `UPDATE orders SET status = 'CANCELLED' WHERE id = $1`,
      /illegal order status transition/,
      [done],
    );
  });

  it("allows only one CAPTURED payment per order and unique gateway ids", async () => {
    const o = await newOrder("LLI-P1");
    const pay = (providerPaymentId, status) =>
      db.query(
        `INSERT INTO payments (order_id, provider_order_id, provider_payment_id, amount_paise, status)
         VALUES ($1, $2, $3, 100000, $4)`,
        [o, `order_${providerPaymentId}`, providerPaymentId, status],
      );
    await pay("pay_1", "CAPTURED");
    await assert.rejects(() => pay("pay_2", "CAPTURED"), /payments_one_captured_per_order/);
    await assert.rejects(() => pay("pay_1", "FAILED"), /payments_provider_(order|payment)_id_key/);
    await rejects(
      `INSERT INTO payments (order_id, amount_paise) VALUES ($1, 0)`,
      /payments_amount_chk/,
      [o],
    );
  });

  it("deduplicates webhook events by provider event id", async () => {
    const insert = () =>
      db.query(
        `INSERT INTO payment_webhook_events (provider_event_id, event_type, payload, signature_valid)
         VALUES ('evt_1', 'payment.captured', '{}', true)`,
      );
    await insert();
    await assert.rejects(insert, /provider_event_id_key/);
  });
});

describe("promotions and reviews", () => {
  it("validates coupons", async () => {
    await rejects(
      `INSERT INTO coupons (code, discount_type, discount_value) VALUES ('lower', 'PERCENT', 10)`,
      /coupons_code_upper_chk/,
    );
    await rejects(
      `INSERT INTO coupons (code, discount_type, discount_value) VALUES ('BIG', 'PERCENT', 10001)`,
      /coupons_value_chk/,
    );
    await db.query(
      `INSERT INTO coupons (code, discount_type, discount_value) VALUES ('WELCOME10', 'PERCENT', 1000)`,
    );
    await rejects(
      `INSERT INTO coupons (code, discount_type, discount_value) VALUES ('WELCOME10', 'FIXED', 5000)`,
      /coupons_code_key/,
    );
  });

  it("limits ratings to 1–5 and one review per user per product", async () => {
    const v = await newVariant("REV-1");
    const product = (await db.query(`SELECT product_id FROM product_variants WHERE id = $1`, [v]))
      .rows[0].product_id;
    const u = await id(
      `INSERT INTO users (email, email_normalized) VALUES ('rev@example.com', 'rev@example.com')`,
    );
    await rejects(
      `INSERT INTO reviews (product_id, user_id, rating) VALUES ($1, $2, 6)`,
      /reviews_rating_chk/,
      [product, u],
    );
    await db.query(`INSERT INTO reviews (product_id, user_id, rating) VALUES ($1, $2, 5)`, [
      product,
      u,
    ]);
    await rejects(
      `INSERT INTO reviews (product_id, user_id, rating) VALUES ($1, $2, 4)`,
      /reviews_product_id_user_id_key/,
      [product, u],
    );
  });
});

describe("append-only tables", () => {
  it("reject UPDATE, DELETE and TRUNCATE on audit, security, inventory and status-history tables", async () => {
    await db.query(
      `INSERT INTO admin_audit_logs (action, entity_type, entity_id) VALUES ('product.update', 'product', 'x')`,
    );
    await db.query(`INSERT INTO security_events (type) VALUES ('login_failed')`);
    const v = await newVariant("APP-1");
    await db.query(
      `INSERT INTO inventory_movements (variant_id, delta, reason) VALUES ($1, 5, 'ADJUSTMENT')`,
      [v],
    );
    const o = await newOrder("LLI-H1");
    await db.query(
      `INSERT INTO order_status_history (order_id, to_status) VALUES ($1, 'PENDING_PAYMENT')`,
      [o],
    );

    for (const table of [
      "admin_audit_logs",
      "security_events",
      "inventory_movements",
      "order_status_history",
    ]) {
      await rejects(`UPDATE ${table} SET created_at = now()`, /append-only/);
      await rejects(`DELETE FROM ${table}`, /append-only/);
      await rejects(`TRUNCATE ${table}`, /append-only/);
      const n = (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
      assert.ok(n >= 1, `${table} lost rows`);
    }
  });
});

after(async () => {
  await db.close();
});

const backendDir = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("reference seed", () => {
  const seed = () => readFileSync(join(backendDir, "db", "seed", "reference_data.sql"), "utf8");

  it("applies, is idempotent, and keeps roles.manage with Super Admin only", async () => {
    await db.exec(seed());
    const count = async (t) => (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
    const before = [
      await count("permissions"),
      await count("roles"),
      await count("role_permissions"),
    ];
    await db.exec(seed());
    const after = [
      await count("permissions"),
      await count("roles"),
      await count("role_permissions"),
    ];
    assert.deepEqual(after, before);
    assert.equal(before[0], 28);
    assert.equal(before[1], 7);

    const holders = await db.query(
      `SELECT r.name FROM roles r
         JOIN role_permissions rp ON rp.role_id = r.id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE p.key = 'roles.manage'`,
    );
    assert.deepEqual(
      holders.rows.map((r) => r.name),
      ["Super Admin"],
    );
  });

  it("inserts GST placeholders inactive and creates no users", async () => {
    const rates = await db.query(`SELECT count(*)::int AS n FROM tax_rates WHERE is_active`);
    assert.equal(rates.rows[0].n, 0);
    const users = await db.query(
      `SELECT count(*)::int AS n FROM users WHERE password_hash IS NOT NULL`,
    );
    assert.equal(users.rows[0].n, 0);
  });
});

describe("roles and grants script", () => {
  it("applies (minus database-level statements) and enforces the intended privileges", async () => {
    let sql = readFileSync(join(backendDir, "db", "roles_and_grants.sql"), "utf8");
    sql = sql
      .replace(/^\\set .*$/gm, "") // psql meta-command
      .replace(/DO \$\$\nBEGIN\n  IF current_database\(\)[\s\S]*?\$\$;/, "") // LLI-only guard (pglite's db is "postgres")
      .replace(/^ALTER ROLE .* IN DATABASE .*$/gm, "") // needs a real "LLI" database
      .replace(/^(REVOKE|GRANT) .* ON DATABASE .*$/gm, "")
      .replace(/:'(\w+)'/g, "'test-only-password'");
    await db.exec(sql);

    const can = async (role, table, priv) =>
      (await db.query(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, table, priv])).rows[0]
        .ok;

    assert.equal(await can("lli_app", "users", "UPDATE"), true);
    assert.equal(await can("lli_app", "orders", "DELETE"), true);
    for (const t of [
      "admin_audit_logs",
      "security_events",
      "inventory_movements",
      "order_status_history",
    ]) {
      assert.equal(await can("lli_app", t, "INSERT"), true, `${t} insert`);
      assert.equal(await can("lli_app", t, "SELECT"), true, `${t} select`);
      assert.equal(await can("lli_app", t, "UPDATE"), false, `${t} update`);
      assert.equal(await can("lli_app", t, "DELETE"), false, `${t} delete`);
      assert.equal(await can("lli_app", t, "TRUNCATE"), false, `${t} truncate`);
    }
    assert.equal(await can("lli_readonly", "products", "SELECT"), true);
    assert.equal(await can("lli_readonly", "products", "UPDATE"), false);
    for (const t of ["users", "sessions", "one_time_tokens", "mfa_credentials", "addresses"]) {
      assert.equal(await can("lli_readonly", t, "SELECT"), false, `readonly must not read ${t}`);
    }
    const create = async (role) =>
      (await db.query(`SELECT has_schema_privilege($1, 'public', 'CREATE') AS ok`, [role])).rows[0]
        .ok;
    assert.equal(await create("lli_migrator"), true);
    assert.equal(await create("lli_app"), false);
    assert.equal(await create("lli_readonly"), false);

    const roles = await db.query(
      `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname LIKE 'lli\_%'`,
    );
    assert.equal(roles.rows.length, 3);
    assert.ok(roles.rows.every((r) => !r.rolsuper && !r.rolcreatedb && !r.rolcreaterole));
  });
});

describe("rollback script", () => {
  const rollbackSql = () =>
    // pglite's database is "postgres"; drop only the LLI-name guard, keep the row-count guard.
    readFileSync(join(backendDir, "db", "rollback_0001_0002.sql"), "utf8").replace(
      /IF current_database\(\) <> 'LLI' THEN[\s\S]*?END IF;/,
      "",
    );

  const applyAll = async (target) => {
    for (const name of migrationNames) {
      await target.exec(readFileSync(join(migrationsDir, name, "migration.sql"), "utf8"));
    }
  };

  it("refuses to run against the real LLI-name guard from another database", async () => {
    const raw = readFileSync(join(backendDir, "db", "rollback_0001_0002.sql"), "utf8");
    const scratch = new PGlite({ extensions: { pg_trgm } });
    await applyAll(scratch);
    await assert.rejects(() => scratch.exec(raw), /expected LLI/);
    await scratch.close();
  });

  it("refuses to drop tables that hold data, and removes everything on an empty schema", async () => {
    const scratch = new PGlite({ extensions: { pg_trgm } });
    await applyAll(scratch);
    await scratch.exec(
      `INSERT INTO users (email, email_normalized) VALUES ('keep@example.com', 'keep@example.com')`,
    );
    await assert.rejects(() => scratch.exec(rollbackSql()), /holds 1 rows/);
    await scratch.exec(`DELETE FROM users`);
    await scratch.exec(rollbackSql());

    const left = async (sql) => (await scratch.query(sql)).rows[0].n;
    assert.equal(
      await left(
        `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
      ),
      0,
    );
    assert.equal(
      await left(
        `SELECT count(*)::int AS n FROM pg_type t JOIN pg_namespace s ON s.oid = t.typnamespace
          WHERE s.nspname = 'public' AND t.typtype = 'e'`,
      ),
      0,
    );
    assert.equal(
      await left(
        `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
          WHERE s.nspname = 'public' AND p.proname LIKE 'lli%'`,
      ),
      0,
    );
    // Re-applying proves the rollback left a clean slate.
    await applyAll(scratch);
    await scratch.close();
  });
});
