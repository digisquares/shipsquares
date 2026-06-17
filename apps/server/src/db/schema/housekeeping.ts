import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { servers } from "./servers.js";

export const dockerCleanupRuns = pgTable(
  "docker_cleanup_runs",
  {
    id: text("id").primaryKey(), // dcr_…
    serverId: text("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    reclaimedBytes: bigint("reclaimed_bytes", { mode: "number" }),
    status: text("status").notNull().default("running"), // running | success | failed
  },
  (t) => ({ serverIdx: index("docker_cleanup_runs_server_idx").on(t.serverId) }),
);
