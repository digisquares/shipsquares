import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import { organizations } from "./organizations.js";

// Self-managed API keys (05): only the sha256 hash of the bearer token is
// stored (auth/api-key-core.ts) — the token is returned exactly once at create.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(), // key_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull().unique(),
    name: text("name").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgIdx: index("api_keys_org_idx").on(t.organizationId) }),
);
