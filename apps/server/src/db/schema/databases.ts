import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { apps } from "./apps.js";
import { dbEngine } from "./enums.js";
import { organizations } from "./organizations.js";

// Managed/shared database servers + provisioned databases/roles (24). The native
// control Postgres is seeded as the is_default server; provisioned roles are
// isolated from control-plane state. Passwords are secret-store references (11).
export const databaseServers = pgTable(
  "database_servers",
  {
    id: text("id").primaryKey(), // dbs_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    engine: dbEngine("engine").notNull().default("postgres"),
    host: text("host").notNull(),
    port: integer("port").notNull().default(5432),
    adminSecretRef: text("admin_secret_ref").notNull(), // → secret store (11)
    isDefault: boolean("is_default").notNull().default(false),
    tls: boolean("tls").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgIdx: index("database_servers_org_idx").on(t.organizationId) }),
);

export const databases = pgTable(
  "databases",
  {
    id: text("id").primaryKey(), // db_…
    serverId: text("server_id")
      .notNull()
      .references(() => databaseServers.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ownerRole: text("owner_role").notNull(),
    appId: text("app_id").references(() => apps.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    serverIdx: index("databases_server_idx").on(t.serverId),
    nameUq: uniqueIndex("databases_server_name_uq").on(t.serverId, t.name),
  }),
);

export const databaseUsers = pgTable(
  "database_users",
  {
    id: text("id").primaryKey(), // dbu_…
    serverId: text("server_id")
      .notNull()
      .references(() => databaseServers.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    passwordSecretRef: text("password_secret_ref").notNull(), // → secret store (11)
    databaseId: text("database_id").references(() => databases.id, { onDelete: "cascade" }),
    grants: jsonb("grants").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    serverIdx: index("database_users_server_idx").on(t.serverId),
    userUq: uniqueIndex("database_users_server_name_uq").on(t.serverId, t.username),
  }),
);
