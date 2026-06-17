import { integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { apps } from "./apps.js";
import { deployments } from "./deployments.js";
import { previewStatus } from "./enums.js";

export const previewEnvironments = pgTable(
  "preview_environments",
  {
    id: text("id").primaryKey(), // prev_…
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    prNumber: integer("pr_number").notNull(),
    prTitle: text("pr_title"),
    prUrl: text("pr_url"),
    branch: text("branch").notNull(),
    status: previewStatus("status").notNull().default("building"),
    domain: text("domain"),
    deploymentId: text("deployment_id").references(() => deployments.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => ({ appPrUq: uniqueIndex("preview_environments_app_pr_uq").on(t.appId, t.prNumber) }),
);
