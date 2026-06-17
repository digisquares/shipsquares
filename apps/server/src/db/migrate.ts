import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "@ss/shared";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Standalone migration runner for the installer bundle (18-installer-ops.md).
// The release bundle ships the committed `drizzle/` SQL but NOT drizzle-kit (a
// devDep), so production migrations run through drizzle-orm's own migrator
// instead of `drizzle-kit migrate`. The journal table/schema
// (`drizzle.__drizzle_migrations`) is identical, so this is interchangeable
// with the dev `db:migrate` flow — running either after the other is a no-op.
//
// Layout-relative folder resolution: compiled to `dist/db/migrate.js`, so
// `../../drizzle` is the package/bundle root `drizzle/` in both the monorepo
// (`apps/server/drizzle`) and the deployed bundle (`<bundle>/drizzle`).
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

const config = loadConfig();
// drizzle's migrator requires a single, non-pooled connection.
const sql = postgres(config.DATABASE_URL, { max: 1 });

try {
  await migrate(drizzle(sql), { migrationsFolder, migrationsSchema: "drizzle" });
  console.log("migrations applied");
} finally {
  await sql.end();
}
