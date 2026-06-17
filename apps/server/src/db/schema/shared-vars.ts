import { boolean, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { aiProvider, sharedVarScope } from "./enums.js";
import { organizations } from "./organizations.js";

// Shared variables resolvable at org/app scope (11). project/environment reserved.
export const sharedVariables = pgTable(
  "shared_variables",
  {
    id: text("id").primaryKey(), // shv_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scope: sharedVarScope("scope").notNull(),
    scopeId: text("scope_id"), // app_id when scope='app'
    key: text("key").notNull(),
    value: text("value"), // when !is_secret
    valueSecretRef: text("value_secret_ref"), // when is_secret (→ secret store 11)
    isSecret: boolean("is_secret").notNull().default(false),
  },
  (t) => ({
    scopeIdx: index("shared_variables_scope_idx").on(t.organizationId, t.scope, t.scopeId),
  }),
);

// BYO Claude key + model selection for the AI chat (22). Key sealed in the
// secret store (11) and referenced by api_key_secret_ref.
export const aiSettings = pgTable(
  "ai_settings",
  {
    id: text("id").primaryKey(), // ai_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: aiProvider("provider").notNull().default("anthropic"),
    model: text("model").notNull().default("claude-sonnet-4-6"),
    apiKeySecretRef: text("api_key_secret_ref"),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgUq: uniqueIndex("ai_settings_org_uq").on(t.organizationId) }),
);
