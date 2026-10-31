// Run order: migrations, reference seed, dev catalogue seed, roles_and_grants.sql, then this file.
// THROWAWAY SERVER ONLY: it reserves stock and inserts users, addresses, orders and webhook rows.
import pg from "pg";
import { host, port, rolePasswords } from "./lib.mjs";

const ap = rolePasswords().app;
const pool = new pg.Pool({ host, port, user: "lli_app", password: ap, database: "LLI", max: 50 });
let fails = 0;
const ok = (label, cond, extra = "") => {
  console.log((cond ? "PASS " : "FAIL ") + label + (extra ? "  " + extra : ""));
  if (!cond) fails++;
};

// 1. Atomic reservation: 120 concurrent buyers, 25 units on hand.
const variant = (
  await pool.query(
    "select v.id from product_variants v join inventory i on i.variant_id=v.id where i.on_hand=25 and i.reserved=0 order by v.sku limit 1",
  )
).rows[0].id;
const attempt = async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query(
      "UPDATE inventory SET reserved = reserved + 1 WHERE variant_id = $1 AND (on_hand - reserved) >= 1",
      [variant],
    );
    if (r.rowCount === 1)
      await c.query(
        "INSERT INTO inventory_reservations (variant_id, quantity, expires_at) VALUES ($1, 1, now() + interval '15 minutes')",
        [variant],
      );
    await c.query("COMMIT");
    return r.rowCount === 1;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
};
const results = await Promise.all(Array.from({ length: 120 }, attempt));
const won = results.filter(Boolean).length;
const inv = (
  await pool.query("select on_hand, reserved from inventory where variant_id=$1", [variant])
).rows[0];
const rows = (
  await pool.query("select count(*)::int n from inventory_reservations where variant_id=$1", [
    variant,
  ])
).rows[0].n;
ok("120 buyers, 25 units: exactly 25 reservations succeed", won === 25, `won=${won}`);
ok(
  "reserved == on_hand and never above",
  inv.reserved === 25 && inv.on_hand === 25,
  JSON.stringify(inv),
);
ok("one reservation row per success", rows === 25, `rows=${rows}`);

// 2. CHECK constraint is the backstop if code skips the guard.
try {
  await pool.query("UPDATE inventory SET reserved = reserved + 1 WHERE variant_id=$1", [variant]);
  ok("unguarded over-reserve rejected by CHECK", false);
} catch (e) {
  ok(
    "unguarded over-reserve rejected by CHECK",
    /inventory_stock_chk/.test(e.message),
    e.message.slice(0, 70),
  );
}

// 3. Duplicate webhook deliveries: 40 parallel inserts of the same event id -> exactly one row.
const dup = await Promise.allSettled(
  Array.from({ length: 40 }, () =>
    pool.query(
      "INSERT INTO payment_webhook_events (provider_event_id, event_type, payload, signature_valid) VALUES ('evt_rehearsal_1','payment.captured','{}',true)",
    ),
  ),
);
const inserted = dup.filter((r) => r.status === "fulfilled").length;
const unique = dup.filter(
  (r) => r.status === "rejected" && /provider_event_id_key/.test(r.reason.message),
).length;
ok(
  "40 duplicate webhook deliveries: exactly 1 accepted",
  inserted === 1 && unique === 39,
  `accepted=${inserted} rejected_unique=${unique}`,
);

// 4. Concurrent signups with the same email -> exactly one account.
const su = await Promise.allSettled(
  Array.from({ length: 30 }, () =>
    pool.query(
      "INSERT INTO users (email, email_normalized) VALUES ('Race@Example.com','race@example.com')",
    ),
  ),
);
ok(
  "30 concurrent signups, same email: exactly 1 account",
  su.filter((r) => r.status === "fulfilled").length === 1,
);

// 5. Concurrent default-address switch: only one default can win.
const uid = (await pool.query("select id from users where email_normalized='race@example.com'"))
  .rows[0].id;
const ad = await Promise.allSettled(
  Array.from({ length: 20 }, (_, i) =>
    pool.query(
      "INSERT INTO addresses (user_id, full_name, phone, line1, city, state, state_code, postal_code, is_default) VALUES ($1,'N','9999999999','L','Delhi','Delhi','07','110001',true)",
      [uid],
    ),
  ),
);
ok(
  "20 concurrent default addresses: exactly 1 accepted",
  ad.filter((r) => r.status === "fulfilled").length === 1,
);

// 6. Race on order status: two workers move the same order; the guard keeps it on legal edges.
const o = (
  await pool.query(
    "INSERT INTO orders (order_number, guest_email, payment_method, subtotal_paise, total_paise, shipping_address) VALUES ('LLI-RACE-1','g@example.com','ONLINE',100000,100000,'{}') RETURNING id",
  )
).rows[0].id;
const moves = await Promise.allSettled(
  ["CONFIRMED", "CANCELLED", "PAYMENT_FAILED", "DELIVERED", "SHIPPED"].map((s) =>
    pool.query("UPDATE orders SET status=$2 WHERE id=$1", [o, s]),
  ),
);
const final = (await pool.query("select status from orders where id=$1", [o])).rows[0].status;
ok(
  "illegal jumps (DELIVERED, SHIPPED) never succeed under contention",
  moves[3].status === "rejected" &&
    moves[4].status === "rejected" &&
    ["CONFIRMED", "CANCELLED", "PAYMENT_FAILED"].includes(final),
  `final=${final}`,
);

await pool.end();
console.log(fails ? `\n${fails} FAILED` : "\nall concurrency checks passed");
process.exit(fails ? 1 : 0);
