import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { apiKeys } from "./api-keys.js";
import { apps } from "./apps.js";
import { users } from "./auth.js";
import { deploymentStatus, deploymentTrigger, logStream, stepStatus } from "./enums.js";
import { organizations } from "./organizations.js";
import { servers } from "./servers.js";

export const deployments = pgTable(
  "deployments",
  {
    id: text("id").primaryKey(), // dpl_…
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    serverId: text("server_id").references(() => servers.id, { onDelete: "set null" }),
    status: deploymentStatus("status").notNull().default("queued"),
    trigger: deploymentTrigger("trigger").notNull(),
    triggeredBy: text("triggered_by").references(() => users.id, { onDelete: "set null" }),
    apiKeyId: text("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    commitBefore: text("commit_before"),
    commitAfter: text("commit_after"),
    errorMessage: text("error_message"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    logLineCount: integer("log_line_count").notNull().default(0), // persisted-log bookkeeping (28)
    logTruncated: boolean("log_truncated").notNull().default(false),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    appIdx: index("deployments_app_idx").on(t.appId),
    orgStatusIdx: index("deployments_org_status_idx").on(t.organizationId, t.status),
    appQueuedIdx: index("deployments_app_queued_idx").on(t.appId, t.queuedAt),
    // Covers the latest-succeeded lookup the reconcile + git-poll sweeps run
    // per app: WHERE app_id=? AND status='succeeded' ORDER BY finished_at DESC.
    appStatusFinishedIdx: index("deployments_app_status_finished_idx").on(
      t.appId,
      t.status,
      t.finishedAt,
    ),
    // Per-app serialization: at most one queued|running deployment per
    // app — the airtight backstop for the create-time check under races.
    oneActivePerApp: uniqueIndex("deployments_one_active_per_app")
      .on(t.appId)
      .where(sql`status IN ('queued', 'running')`),
  }),
);

export const deploymentSteps = pgTable(
  "deployment_steps",
  {
    id: text("id").primaryKey(), // stp_…
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(), // 0..n, fixed pipeline order
    name: text("name").notNull(), // fetch|build|preUp|up|health|route|prune
    status: stepStatus("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({ deplIdx: index("deployment_steps_depl_idx").on(t.deploymentId, t.ordinal) }),
);

// Persisted, capped ring-buffer of build/deploy output — last ~5000 lines per
// deployment, append-only INSERTs + batched seq-arithmetic trim (28-deployment-logs.md).
export const deploymentLogs = pgTable(
  "deployment_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    stepId: text("step_id").references(() => deploymentSteps.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(), // monotonic within deployment
    stream: logStream("stream").notNull().default("stdout"),
    line: text("line").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ deplSeqIdx: index("deployment_logs_depl_seq_idx").on(t.deploymentId, t.seq) }),
);
