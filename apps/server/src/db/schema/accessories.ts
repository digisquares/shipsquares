import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { apps } from "./apps.js";
import { accessoryType } from "./enums.js";
import { organizations } from "./organizations.js";

export type BackupConfig = { schedule?: string; retentionDays?: number; destination?: string };

export const accessories = pgTable(
  "accessories",
  {
    id: text("id").primaryKey(), // acc_…
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: accessoryType("type").notNull(),
    image: text("image").notNull(),
    volume: text("volume"),
    backupCfg: jsonb("backup_cfg").$type<BackupConfig>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ appIdx: index("accessories_app_idx").on(t.appId) }),
);
