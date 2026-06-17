import { loadConfig } from "@ss/shared";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema/index.js";

// The control-plane Postgres connection (native; 03-data-model.md). pg-boss
// owns its own `pgboss` schema separately (see queue.ts); Drizzle only manages
// `public` + the `drizzle` journal.
const config = loadConfig();
const client = postgres(config.DATABASE_URL, { max: 10 });

export const db = drizzle(client, { schema });
export type Db = typeof db;
export { client, schema };
