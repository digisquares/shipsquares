import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { apps } from "./apps.js";
import { scheduledJobStatus, scheduledJobTarget } from "./enums.js";
import { organizations } from "./organizations.js";
import { servers } from "./servers.js";

export const scheduledJobs = pgTable(
  "scheduled_jobs",
  {
    id: text("id").primaryKey(), // job_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    target: scheduledJobTarget("target").notNull(),
    appId: text("app_id").references(() => apps.id, { onDelete: "cascade" }),
    serverId: text("server_id").references(() => servers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    command: text("command").notNull(),
    shell: text("shell").notNull().default("bash"), // bash | sh
    cron: text("cron").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgIdx: index("scheduled_jobs_org_idx").on(t.organizationId) }),
);

export const scheduledJobRuns = pgTable(
  "scheduled_job_runs",
  {
    id: text("id").primaryKey(), // jrun_…
    jobId: text("job_id")
      .notNull()
      .references(() => scheduledJobs.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: scheduledJobStatus("status").notNull().default("running"),
    exitCode: integer("exit_code"),
    outputTail: text("output_tail"), // last N lines of run output (clamped)
    error: text("error"),
  },
  (t) => ({ jobIdx: index("scheduled_job_runs_job_idx").on(t.jobId, t.startedAt) }),
);
