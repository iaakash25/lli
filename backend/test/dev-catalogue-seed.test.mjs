// The development catalogue seed must reproduce the storefront's current catalogue exactly.
// Runs against an in-memory PostgreSQL (pglite); no real database is touched.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { buildDevCatalogueSql } from "../scripts/generate-dev-catalogue-seed.mjs";
import { loadCatalog } from "../scripts/lib/load-catalog.mjs";

const backendDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(backendDir, "prisma", "migrations");
const seedPath = join(backendDir, "db", "seed", "dev_catalogue.sql");
// Normalise line endings: git on Windows may check the file out with CRLF.
const seedSql = readFileSync(seedPath, "utf8").replaceAll("\r\n", "\n");

let db;
let catalog;

const n = async (sql, params) => (await db.query(sql, params)).rows[0].n;
const count = (table) => n(`SELECT count(*)::int AS n FROM ${table}`);
const runSeed = () => db.exec(`SET lli.allow_dev_seed = 'on';\n${seedSql}`);

before(async () => {
  db = new PGlite({ extensions: { pg_trgm } });
  const names = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const name of names) {
    await db.exec(readFileSync(join(migrationsDir, name, "migration.sql"), "utf8"));
  }
  catalog = await loadCatalog();
});

after(async () => {
  await db.close();
});

describe("dev catalogue seed", () => {
  it("is up to date with src/lib/catalog.ts (re-run `npm run seed:dev:generate` if not)", async () => {
    assert.equal(await buildDevCatalogueSql(), seedSql);
  });

  it("refuses to run without the explicit opt-in", async () => {
    await assert.rejects(() => db.exec(seedSql), /dev catalogue seed refused/);
    assert.equal(await count("products"), 0);
  });

  it("loads the full storefront catalogue", async () => {
    await runSeed();
    assert.equal(await count("products"), 22);
    assert.equal(await count("collections"), 8);
    assert.equal(await count("categories"), 13);
    assert.equal(await count("media_assets"), 13);
    assert.equal(await count("product_images"), 22 * 3);
    const variants = catalog.PRODUCTS.reduce(
      (sum, p) => sum + p.colours.length * (p.sizes?.length ?? 1),
      0,
    );
    assert.equal(await count("product_variants"), variants);
    assert.equal(await count("inventory"), variants);
  });

  it("reproduces product data and prices in paise", async () => {
    for (const p of catalog.PRODUCTS) {
      const row = (await db.query(`SELECT * FROM products WHERE slug = $1`, [p.slug])).rows[0];
      assert.ok(row, `missing product ${p.slug}`);
      assert.equal(row.name, p.name);
      assert.equal(row.product_type, p.type);
      assert.equal(row.gender, p.gender.toUpperCase());
      assert.equal(row.rank, p.rank);
      assert.equal(row.is_new, !!p.isNew);
      assert.equal(row.is_gift, !!p.gift);
      assert.equal(row.status, "ACTIVE");
      const prices = await db.query(
        `SELECT DISTINCT price_paise FROM product_variants WHERE product_id = $1`,
        [row.id],
      );
      assert.deepEqual(
        prices.rows.map((r) => r.price_paise),
        [p.price * 100],
        `${p.slug} price`,
      );
    }
    assert.equal(await count("product_variants WHERE cost_paise IS NOT NULL"), 0);
    assert.equal(await count("products WHERE hsn_code IS NOT NULL OR tax_rate_id IS NOT NULL"), 0);
  });

  it("copies each collection's membership from the storefront filters", async () => {
    for (const c of catalog.COLLECTIONS) {
      const rows = await db.query(
        `SELECT p.slug FROM collection_products cp
           JOIN collections col ON col.id = cp.collection_id
           JOIN products p ON p.id = cp.product_id
          WHERE col.slug = $1 ORDER BY p.slug`,
        [c.slug],
      );
      const expected = catalog.PRODUCTS.filter(c.filter)
        .map((p) => p.slug)
        .sort();
      assert.deepEqual(
        rows.rows.map((r) => r.slug),
        expected,
        `collection ${c.slug}`,
      );
    }
  });

  it("maps the storefront stock labels to opening stock and ledger rows", async () => {
    const expected = { in: 25, low: 2, out: 0 };
    for (const p of catalog.PRODUCTS) {
      const rows = await db.query(
        `SELECT i.on_hand, i.reserved FROM inventory i
           JOIN product_variants v ON v.id = i.variant_id
           JOIN products pr ON pr.id = v.product_id WHERE pr.slug = $1`,
        [p.slug],
      );
      assert.ok(rows.rows.length > 0);
      for (const r of rows.rows) {
        assert.equal(r.on_hand, expected[p.stock], `${p.slug} on_hand`);
        assert.equal(r.reserved, 0);
      }
    }
    const withStock = await count("inventory WHERE on_hand > 0");
    assert.equal(await count("inventory_movements"), withStock);
    assert.equal(
      await n(
        `SELECT count(*)::int AS n FROM inventory i
           JOIN (SELECT variant_id, sum(delta) AS total FROM inventory_movements GROUP BY 1) m
             ON m.variant_id = i.variant_id WHERE m.total <> i.on_hand`,
      ),
      0,
      "ledger must equal on_hand",
    );
  });

  it("builds a two-level category tree covering every product type", async () => {
    const parents = await db.query(
      `SELECT slug FROM categories WHERE parent_id IS NULL ORDER BY slug`,
    );
    assert.deepEqual(
      parents.rows.map((r) => r.slug),
      ["bags", "small-leather-goods"],
    );
    assert.equal(await count("product_categories"), 22);
    assert.equal(
      await n(
        `SELECT count(*)::int AS n FROM products p
          WHERE NOT EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id)`,
      ),
      0,
    );
  });

  it("is idempotent and never resets stock that has changed", async () => {
    await db.exec(
      `UPDATE inventory SET on_hand = 7 WHERE variant_id = (SELECT variant_id FROM inventory LIMIT 1)`,
    );
    const before = {
      products: await count("products"),
      variants: await count("product_variants"),
      movements: await count("inventory_movements"),
      collectionProducts: await count("collection_products"),
    };
    await runSeed();
    assert.deepEqual(
      {
        products: await count("products"),
        variants: await count("product_variants"),
        movements: await count("inventory_movements"),
        collectionProducts: await count("collection_products"),
      },
      before,
    );
    assert.equal(await count("inventory WHERE on_hand = 7"), 1);
  });

  it("makes the seeded products searchable", async () => {
    const hits = await db.query(
      `SELECT slug FROM products WHERE search_vector @@ plainto_tsquery('simple', 'tote') ORDER BY slug`,
    );
    assert.ok(hits.rows.some((r) => r.slug === "meridian-tote"));
  });
});
