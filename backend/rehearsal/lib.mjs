// Shared helpers for the PostgreSQL rehearsal checks.
//
// THROWAWAY SERVER ONLY. These scripts create and drop databases, roles and rows. They refuse to
// connect to anything but a loopback address. Never point them at the shared production server.
import pg from "pg";

export const host = process.env.REHEARSAL_HOST ?? "127.0.0.1";
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error(
    `refusing to run against ${host}: rehearsal scripts only run on a local throwaway server`,
  );
}

export const port = Number(process.env.REHEARSAL_PORT ?? 54313);
export const user = process.env.REHEARSAL_USER ?? "rehearsal";
export const pw = process.env.REHEARSAL_PASSWORD ?? "";
if (!pw) throw new Error("set REHEARSAL_PASSWORD (the throwaway server's superuser password)");

// "migrator,app,readonly" passwords given to roles_and_grants.sql, comma separated.
export const rolePasswords = () => {
  const [migrator, app, readonly] = (process.env.REHEARSAL_ROLE_PASSWORDS ?? "").split(",");
  if (!migrator || !app || !readonly)
    throw new Error("set REHEARSAL_ROLE_PASSWORDS=migrator,app,readonly");
  return { migrator, app, readonly };
};

export const connect = async (database = "LLI", asUser = user, password = pw) => {
  const c = new pg.Client({ host, port, user: asUser, password, database });
  await c.connect();
  return c;
};

export const one = async (c, sql, params) => (await c.query(sql, params)).rows[0];
