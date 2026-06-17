import { defineConfig } from "drizzle-kit";

// `db:generate` diffs the schema offline (no DB needed); `db:migrate`/`db:push`/
// `db:studio` connect using DATABASE_URL. pg-boss owns the separate `pgboss`
// schema at runtime, so drizzle-kit only manages `public` + the `drizzle` journal.
// NodeNext `.js` import specifiers don't resolve under drizzle-kit's loader, so
// we point it at the compiled schema in dist (the db:* scripts run `tsc -b` first).
export default defineConfig({
  schema: "./dist/db/schema/index.js",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Fallback matches infra/docker-compose.dev.yml so the Option-A dev flow works
    url: process.env.DATABASE_URL ?? "postgres://postgres:dev@localhost:5432/shipsquares_dev",
  },
  migrations: { schema: "drizzle" },
});
