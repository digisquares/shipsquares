import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { dbEngine } from "./enums.js";
import { organizations } from "./organizations.js";

// External database connection profiles for the Database Studio
// (database-studio/02-data-model-and-introspection.md). Managed connections are
// synthesized from database_servers/databases at list time — only BYO external
// servers get a row here. The password is the only secret and is sealed exactly
// like vcs token refs (11); the view never exposes passwordSecretRef. mariadb
// resolves to the mysql driver. Org-scoped + cascade-deleted for tenant isolation.
export const dbConnections = pgTable(
  "db_connections",
  {
    id: text("id").primaryKey(), // dbc_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    engine: dbEngine("engine").notNull(),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    database: text("database").notNull(),
    username: text("username").notNull(),
    passwordSecretRef: text("password_secret_ref").notNull(), // sealed JSON → secret store (11)
    tls: boolean("tls").notNull().default(true),
    readOnly: boolean("read_only").notNull().default(true), // per-profile write gate (write path R(db).2)
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgIdx: index("db_connections_org_idx").on(t.organizationId) }),
);
