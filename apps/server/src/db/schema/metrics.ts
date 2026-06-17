import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { apps } from "./apps.js";
import { metricScope } from "./enums.js";
import { notificationChannels } from "./notifications.js";
import { organizations } from "./organizations.js";
import { servers } from "./servers.js";

// Time-series; retention via batched trim + optional rollups (32).
export const metricSamples = pgTable(
  "metric_samples",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    scope: metricScope("scope").notNull(),
    serverId: text("server_id").references(() => servers.id, { onDelete: "cascade" }),
    appId: text("app_id").references(() => apps.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    cpuPct: real("cpu_pct"),
    memBytes: bigint("mem_bytes", { mode: "number" }),
    memLimitBytes: bigint("mem_limit_bytes", { mode: "number" }), // overlaid vs apps.mem_limit_bytes
    diskBytes: bigint("disk_bytes", { mode: "number" }),
    diskTotalBytes: bigint("disk_total_bytes", { mode: "number" }), // R1 tail: for disk % alerts
    netRxBytes: bigint("net_rx_bytes", { mode: "number" }),
    netTxBytes: bigint("net_tx_bytes", { mode: "number" }),
  },
  (t) => ({
    serverTsIdx: index("metric_samples_server_ts_idx").on(t.scope, t.serverId, t.ts),
    appTsIdx: index("metric_samples_app_ts_idx").on(t.scope, t.appId, t.ts),
  }),
);

export const metricAlerts = pgTable(
  "metric_alerts",
  {
    id: text("id").primaryKey(), // malert_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scope: metricScope("scope").notNull(), // 'server' | 'app'
    targetId: text("target_id").notNull(), // server_id or app_id
    metric: text("metric").notNull(), // 'cpu' | 'mem' | 'disk'
    thresholdPct: real("threshold_pct").notNull(),
    windowSeconds: integer("window_seconds").notNull().default(300),
    channelId: text("channel_id").references(() => notificationChannels.id),
    enabled: boolean("enabled").notNull().default(true),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }), // cooldown anchor
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgIdx: index("metric_alerts_org_idx").on(t.organizationId) }),
);
