// Test database adapter. By default tests run on an in-memory PostgreSQL (pglite). Set
// TEST_DATABASE_URL to run the same tests on a real PostgreSQL server instead (used for the
// PostgreSQL 13 rehearsal): each createDb() call then creates a fresh, uniquely named database on
// that server and drops it again on close().
//
// TEST_DATABASE_URL must point at a THROWAWAY server (the user needs CREATE DATABASE, and the
// extension pg_trgm must be creatable). Never point it at the shared production server.
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import pg from "pg";

const serverUrl = process.env.TEST_DATABASE_URL;

export const engine = serverUrl ? "postgres" : "pglite";

export async function createDb() {
  if (!serverUrl) {
    const db = new PGlite({ extensions: { pg_trgm } });
    return {
      exec: (sql) => db.exec(sql),
      query: async (sql, params) => {
        const r = await db.query(sql, params);
        return { rows: r.rows, affectedRows: r.affectedRows };
      },
      close: () => db.close(),
    };
  }

  const name = `lli_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);

  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();

  return {
    exec: async (sql) => {
      await client.query(sql); // no parameters: simple protocol, multiple statements allowed
    },
    query: async (sql, params) => {
      const r = await client.query(sql, params);
      return { rows: r.rows, affectedRows: r.rowCount };
    },
    close: async () => {
      await client.end();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
    },
  };
}
