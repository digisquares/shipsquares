import { NotFoundError, ValidationError, newId } from "@ss/shared";
import { and, desc, eq } from "drizzle-orm";
import type PgBoss from "pg-boss";

import type { Db } from "../db/index.js";
import { apps, scheduledJobRuns, scheduledJobs, servers } from "../db/schema/index.js";
import { runCommand } from "../deploy/exec.js";
import { containerName } from "../deploy/executor.js";
import { swallow } from "../lib/swallow.js";
import { isValidCron, jobExecCommand, scheduleQueueName, tailOutput } from "../schedules/core.js";

// Scheduled jobs (29-scheduled-jobs.md): user cron against an app container or
// the host, on pg-boss cron (one queue per job so registration is individually
// addressable). The composition core is unit-tested; this service is the
// DB/pg-boss runtime around it. Server-target remote execution arrives with the
// 09 transport wiring — until then those runs fail with a clear message.

const RUN_TIMEOUT_MS = 10 * 60_000;
const TAIL_LINES = 50;
const TAIL_BYTES = 8192;

type JobRow = typeof scheduledJobs.$inferSelect;

export interface ScheduleView {
  id: string;
  name: string;
  target: "app_container" | "service" | "server";
  appId: string | null;
  serverId: string | null;
  command: string;
  shell: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  createdAt: string;
}

function toView(r: JobRow): ScheduleView {
  return {
    id: r.id,
    name: r.name,
    target: r.target,
    appId: r.appId,
    serverId: r.serverId,
    command: r.command,
    shell: r.shell,
    cron: r.cron,
    timezone: r.timezone,
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listSchedules(db: Db, orgId: string): Promise<ScheduleView[]> {
  const rows = await db
    .select()
    .from(scheduledJobs)
    .where(eq(scheduledJobs.organizationId, orgId))
    .orderBy(desc(scheduledJobs.createdAt));
  return rows.map(toView);
}

export interface CreateScheduleInput {
  name: string;
  target: "app_container" | "service" | "server";
  appId?: string;
  serverId?: string;
  command: string;
  shell?: string;
  cron: string;
  timezone?: string;
}

export async function createSchedule(
  db: Db,
  orgId: string,
  input: CreateScheduleInput,
): Promise<ScheduleView> {
  if (!isValidCron(input.cron)) {
    throw new ValidationError("cron must be a 5-field expression (numeric, * , - /)");
  }
  const shell = input.shell ?? "bash";
  if (shell !== "bash" && shell !== "sh") throw new ValidationError("shell must be bash or sh");
  if (input.target === "service") {
    throw new ValidationError(
      "service (compose) targets arrive with the compose path - use app_container",
    );
  }
  if (input.target === "app_container") {
    if (!input.appId) throw new ValidationError("appId is required for container-target schedules");
    const app = await db
      .select({ id: apps.id })
      .from(apps)
      .where(and(eq(apps.id, input.appId), eq(apps.organizationId, orgId)))
      .limit(1);
    if (!app[0]) throw new ValidationError("appId does not reference an app in this org");
  } else if (input.serverId) {
    const srv = await db
      .select({ id: servers.id })
      .from(servers)
      .where(and(eq(servers.id, input.serverId), eq(servers.organizationId, orgId)))
      .limit(1);
    if (!srv[0]) throw new ValidationError("serverId does not reference a server in this org");
  }
  const rows = await db
    .insert(scheduledJobs)
    .values({
      id: newId("job"),
      organizationId: orgId,
      target: input.target,
      appId: input.appId ?? null,
      serverId: input.serverId ?? null,
      name: input.name,
      command: input.command,
      shell,
      cron: input.cron,
      timezone: input.timezone ?? "UTC",
    })
    .returning();
  return toView(rows[0]!);
}

export async function deleteSchedule(
  db: Db,
  boss: PgBoss,
  orgId: string,
  id: string,
): Promise<void> {
  const rows = await db
    .delete(scheduledJobs)
    .where(and(eq(scheduledJobs.id, id), eq(scheduledJobs.organizationId, orgId)))
    .returning({ id: scheduledJobs.id });
  if (!rows[0]) throw new NotFoundError("schedule not found");
  await boss.unschedule(scheduleQueueName(id)).catch(() => undefined);
}

/** Execute one run now and record it (scheduled_job_runs). Never throws. */
export async function runScheduleNow(db: Db, job: JobRow): Promise<void> {
  const runId = newId("jrun");
  await db.insert(scheduledJobRuns).values({ id: runId, jobId: job.id });
  let status: "success" | "failed" = "success";
  let exitCode: number | null = null;
  let error: string | undefined;
  let tail = "";
  try {
    if (job.target === "server" && job.serverId) {
      // Remote host runs need the 09 transport wiring (server key resolution).
      throw new Error("remote server schedules are not wired yet — local only");
    }
    const line = jobExecCommand({
      target: job.target,
      ...(job.appId ? { container: containerName(job.appId) } : {}),
      shell: job.shell,
      command: job.command,
    });
    const res = await runCommand("bash", ["-c", line], { timeoutMs: RUN_TIMEOUT_MS });
    exitCode = res.code;
    tail = tailOutput(
      res.lines.map((l) => l.line),
      TAIL_LINES,
      TAIL_BYTES,
    );
    if (res.code !== 0) {
      status = "failed";
      error = `exit ${res.code}${res.timedOut ? " (timed out)" : ""}`;
    }
  } catch (e) {
    status = "failed";
    error = e instanceof Error ? e.message : String(e);
  }
  await db
    .update(scheduledJobRuns)
    .set({
      status,
      finishedAt: new Date(),
      exitCode,
      outputTail: tail,
      ...(error ? { error } : {}),
    })
    .where(eq(scheduledJobRuns.id, runId))
    .catch((e) => swallow("schedule.record_run", e));
}

// One worker per schedule queue; guarded so re-sync never double-registers.
const workersRegistered = new Set<string>();

async function ensureWorker(db: Db, boss: PgBoss, jobId: string): Promise<void> {
  const qname = scheduleQueueName(jobId);
  if (workersRegistered.has(qname)) return;
  workersRegistered.add(qname);
  await boss.work(qname, async () => {
    const fresh = (
      await db.select().from(scheduledJobs).where(eq(scheduledJobs.id, jobId)).limit(1)
    )[0];
    if (!fresh?.enabled) return;
    await runScheduleNow(db, fresh);
  });
}

/** Register cron + worker for one schedule (create/update path). */
export async function syncSchedule(db: Db, boss: PgBoss, job: JobRow): Promise<void> {
  const qname = scheduleQueueName(job.id);
  await boss.unschedule(qname).catch(() => undefined);
  if (!job.enabled) return;
  // pg-boss v10: schedule/work throw on a queue that was never created.
  await boss.createQueue(qname);
  await boss.schedule(qname, job.cron, {}, { tz: job.timezone });
  await ensureWorker(db, boss, job.id);
}

/** Boot-time re-registration of every enabled schedule (Dokploy's initCronJobs).
 *  Each row is isolated: a single bad schedule (e.g. an out-of-range cron stored
 *  before validation was tightened, or an invalid tz) must not abort the loop and
 *  leave every later schedule — including other orgs' — unregistered. Returns the
 *  count that registered cleanly. */
export async function bootSchedules(db: Db, boss: PgBoss): Promise<number> {
  const rows = await db.select().from(scheduledJobs).where(eq(scheduledJobs.enabled, true));
  let registered = 0;
  for (const job of rows) {
    try {
      await syncSchedule(db, boss, job);
      registered += 1;
    } catch (e) {
      swallow(`schedule.boot_register:${job.id}`, e);
    }
  }
  return registered;
}

/** Internal row fetch for the run-now route (org-scoped). */
export async function getScheduleRow(db: Db, orgId: string, id: string): Promise<JobRow> {
  const rows = await db
    .select()
    .from(scheduledJobs)
    .where(and(eq(scheduledJobs.id, id), eq(scheduledJobs.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("schedule not found");
  return rows[0];
}

export interface ScheduleRunView {
  id: string;
  status: string;
  exitCode: number | null;
  outputTail: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export async function listScheduleRuns(
  db: Db,
  orgId: string,
  scheduleId: string,
): Promise<ScheduleRunView[]> {
  await getScheduleRow(db, orgId, scheduleId); // 404 if cross-tenant
  const rows = await db
    .select()
    .from(scheduledJobRuns)
    .where(eq(scheduledJobRuns.jobId, scheduleId))
    .orderBy(desc(scheduledJobRuns.startedAt))
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    exitCode: r.exitCode,
    outputTail: r.outputTail,
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  }));
}
