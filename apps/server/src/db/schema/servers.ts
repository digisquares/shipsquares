import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { serverRole, serverStatus } from "./enums.js";
import { organizations } from "./organizations.js";

export const servers = pgTable(
  "servers",
  {
    id: text("id").primaryKey(), // srv_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    host: text("host").notNull(), // ip or fqdn
    sshPort: integer("ssh_port").notNull().default(22),
    sshUser: text("ssh_user").notNull().default("root"),
    sshRef: text("ssh_ref"), // reference to stored key/secret (11-secrets)
    role: serverRole("role").notNull().default("worker"),
    status: serverStatus("status").notNull().default("adding"), // lifecycle FSM (servers/model.ts)
    dockerOk: boolean("docker_ok").notNull().default(false),
    caddyOk: boolean("caddy_ok").notNull().default(false),
    dockerCleanupEnabled: boolean("docker_cleanup_enabled").notNull().default(true), // housekeeping (18)
    dockerCleanupThresholdPct: integer("docker_cleanup_threshold_pct").notNull().default(80),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({ orgIdx: index("servers_org_idx").on(t.organizationId) }),
);
