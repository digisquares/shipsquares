import { bigint, boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { databaseServers, databases } from "./databases.js";
import {
  dbBackupStatus,
  dbBackupTarget,
  dbBackupType,
  dbReplicaMode,
  dbReplicaStatus,
} from "./enums.js";
import { organizations } from "./organizations.js";

export const dbBackupConfigs = pgTable(
  "db_backup_configs",
  {
    id: text("id").primaryKey(), // bkc_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    serverId: text("server_id")
      .notNull()
      .references(() => databaseServers.id, { onDelete: "cascade" }),
    databaseId: text("database_id").references(() => databases.id, { onDelete: "cascade" }),
    type: dbBackupType("type").notNull().default("logical"),
    schedule: text("schedule").notNull(), // cron
    retentionDays: integer("retention_days").notNull().default(14), // calendar window
    keepNewest: integer("keep_newest").notNull().default(14), // count floor
    target: dbBackupTarget("target").notNull(),
    targetRef: text("target_ref"), // → secret store creds (11)
    enabled: boolean("enabled").notNull().default(true),
    // PITR (physical base + WAL archiving). slot_name + wal_schedule are set when
    // wal_archive is on; last_wal_* track the most recent drain for status.
    walArchive: boolean("wal_archive").notNull().default(false),
    slotName: text("slot_name"),
    walSchedule: text("wal_schedule"),
    lastWalLsn: text("last_wal_lsn"),
    lastWalAt: timestamp("last_wal_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ serverIdx: index("db_backup_configs_server_idx").on(t.serverId) }),
);

export const dbBackups = pgTable(
  "db_backups",
  {
    id: text("id").primaryKey(), // bkp_…
    configId: text("config_id")
      .notNull()
      .references(() => dbBackupConfigs.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: dbBackupStatus("status").notNull().default("running"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    location: text("location"),
    error: text("error"),
  },
  (t) => ({ cfgIdx: index("db_backups_config_idx").on(t.configId) }),
);

export const dbReplicas = pgTable(
  "db_replicas",
  {
    id: text("id").primaryKey(), // rpl_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    primaryServerId: text("primary_server_id")
      .notNull()
      .references(() => databaseServers.id, { onDelete: "cascade" }),
    replicaServerId: text("replica_server_id").references(() => databaseServers.id, {
      onDelete: "set null",
    }),
    replicaHost: text("replica_host"),
    mode: dbReplicaMode("mode").notNull().default("streaming"),
    slotName: text("slot_name"),
    status: dbReplicaStatus("status").notNull().default("pending"),
    lagBytes: bigint("lag_bytes", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ primaryIdx: index("db_replicas_primary_idx").on(t.primaryServerId) }),
);
