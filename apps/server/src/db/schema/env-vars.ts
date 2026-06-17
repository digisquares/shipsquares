import { boolean, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { apps } from "./apps.js";
import { organizations } from "./organizations.js";

export const envVars = pgTable(
  "env_vars",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value"), // plaintext if !is_secret; ciphertext if is_secret
    valueRef: text("value_ref"), // external secret reference (Kamal-style)
    isSecret: boolean("is_secret").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    appKeyUq: unique("env_vars_app_key_uq").on(t.appId, t.key),
    appIdx: index("env_vars_app_idx").on(t.appId),
  }),
);
