import { boolean, index, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { apps } from "./apps.js";
import { certStatus } from "./enums.js";
import { organizations } from "./organizations.js";

export const domains = pgTable(
  "domains",
  {
    id: text("id").primaryKey(), // dom_…
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fqdn: text("fqdn").notNull(),
    targetPort: integer("target_port").notNull().default(3000),
    https: boolean("https").notNull().default(true),
    certStatus: certStatus("cert_status").notNull().default("pending"),
    certError: text("cert_error"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    fqdnUq: unique("domains_fqdn_uq").on(t.fqdn), // a fqdn maps to one app globally
    appIdx: index("domains_app_idx").on(t.appId),
    orgIdx: index("domains_org_idx").on(t.organizationId),
  }),
);
