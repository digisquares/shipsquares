import { loadConfig } from "@ss/shared";
import PgBoss from "pg-boss";

// pg-boss runs against the same Postgres in its own `pgboss` schema, so it never
// collides with our Drizzle-managed `public` tables (03-data-model.md). Job
// names/handlers are defined in 06-deploy-engine.md. Started at server boot.
export function createBoss(): PgBoss {
  const config = loadConfig();
  return new PgBoss({ connectionString: config.DATABASE_URL, schema: "pgboss" });
}
