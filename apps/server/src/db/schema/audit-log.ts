import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { apiKeys } from "./api-keys.js";
import { users } from "./auth.js";
import { organizations } from "./organizations.js";

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorApiKeyId: text("actor_api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    action: text("action").notNull(), // deploy|create|update|delete|rollback|...
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("audit_log_org_idx").on(t.organizationId),
    actorIdx: index("audit_log_actor_idx").on(t.actorUserId),
    createdIdx: index("audit_log_created_idx").on(t.createdAt),
  }),
);
