import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organizations } from "./organizations.js";

// Installed catalog templates (17-catalog-accessories.md): one row per
// compose-project instance of a vendored template. Distinct from
// `accessories` (app-attached sidecars) — these are standalone org services.
export const catalogServices = pgTable(
  "catalog_services",
  {
    id: text("id").primaryKey(), // svc_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(), // catalog template slug
    name: text("name").notNull(),
    status: text("status").notNull().default("installing"), // installing|running|failed|removed
    error: text("error"),
    /** SERVICE_FQDN/URL tokens the install left unset (domain wiring pending) */
    unsupportedTokens: jsonb("unsupported_tokens").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgIdx: index("catalog_services_org_idx").on(t.organizationId) }),
);
