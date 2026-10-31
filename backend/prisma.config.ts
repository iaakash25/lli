import { defineConfig } from "prisma/config";

// DATABASE_URL must point at the LLI database only (see docs/IMPLEMENTATION_ROADMAP.md, Phase 1).
// It is read from the environment and never defaulted to a real host.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
