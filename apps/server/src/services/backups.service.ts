import { AppError, NotFoundError, ValidationError, newId } from "@ss/shared";
import type { Env } from "@ss/shared";
import { and, desc, eq } from "drizzle-orm";
import type PgBoss from "pg-boss";

import {
  dumpCommandHost,
  restorePipelineHost,
  s3Remote,
  shq,
  type S3Destination,
} from "../backups/commands.js";
import { baseBackupCommandHost, restorePlanSteps, type PgHostTarget } from "../backups/pitr.js";
import { runRestore } from "../backups/restore.js";
import { runBackup } from "../backups/runner.js";
import { runWalArchive } from "../backups/wal.js";
import type { Db } from "../db/index.js";
import {
  databaseServers,
  databaseUsers,
  databases,
  dbBackupConfigs,
  dbBackups,
} from "../db/schema/index.js";
import { runCommand } from "../deploy/exec.js";
import { isValidCron, nextCronRun } from "../schedules/core.js";
import { loadMasterKey, open, seal } from "../secrets/crypto.js";
import type { SealedValue } from "../secrets/types.js";

// Scheduled backups for provisioned databases (27 over 24): the destination
// (S3 creds + prefix) is sealed in target_ref; runs execute the TDD'd engine
// (backups/runner.ts) against the managed host PG with the owner role's
// sealed credentials, recording every run in db_backups. Cron rides pg-boss
// like schedules (one queue per config, boot re-sync). Retention is
// keep-N ∪ N-days: keep_newest is the count floor, retention_days the
// calendar window.
const KEY_VERSION = 1;
const RUN_TIMEOUT_MS = 30 * 60_000;

// rclone + the pg client tools run under the control plane's strict systemd
// sandbox (ProtectSystem=strict, ProtectHome=true). Point HOME/TMPDIR at the one
// writable path and disable rclone's config file so inline-remote uploads work.
const BACKUP_EXEC_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  HOME: "/var/lib/shipsquares",
  TMPDIR: "/var/lib/shipsquares",
  RCLONE_CONFIG: "/dev/null",
};

function masterKey(config: Env): Buffer {
  try {
    return loadMasterKey(config.SHIPSQUARES_MASTER_KEY);
  } catch {
    throw new AppError("backups require SHIPSQUARES_MASTER_KEY", {
      status: 400,
      code: "secrets.unconfigured",
    });
  }
}
const sealStr = (plain: string, config: Env): string =>
  JSON.stringify(seal(plain, masterKey(config), KEY_VERSION));
const openStr = (s: string, config: Env): string =>
  open(JSON.parse(s) as SealedValue, masterKey(config));

interface SealedTarget {
  dest: S3Destination;
  prefix?: string;
}

type ConfigRow = typeof dbBackupConfigs.$inferSelect;

export interface LastRunView {
  status: string;
  sizeBytes: number | null;
  finishedAt: string | null;
}

export interface BackupConfigView {
  id: string;
  serverId: string;
  databaseId: string | null;
  type: string;
  schedule: string;
  walArchive: boolean;
  walSchedule: string | null;
  keepNewest: number;
  retentionDays: number;
  enabled: boolean;
  lastWalAt: string | null;
  nextRunAt: string | null;
  lastRun: LastRunView | null;
  createdAt: string;
}

export function toConfigView(r: ConfigRow, lastRun: LastRunView | null = null): BackupConfigView {
  return {
    id: r.id,
    serverId: r.serverId,
    databaseId: r.databaseId,
    type: r.type,
    schedule: r.schedule,
    walArchive: r.walArchive,
    walSchedule: r.walSchedule,
    keepNewest: r.keepNewest,
    retentionDays: r.retentionDays,
    enabled: r.enabled,
    lastWalAt: r.lastWalAt?.toISOString() ?? null,
    nextRunAt: r.enabled ? (nextCronRun(r.schedule, new Date())?.toISOString() ?? null) : null,
    lastRun,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listBackupConfigs(db: Db, orgId: string): Promise<BackupConfigView[]> {
  const rows = await db
    .select()
    .from(dbBackupConfigs)
    .where(eq(dbBackupConfigs.organizationId, orgId))
    .orderBy(desc(dbBackupConfigs.createdAt));
  // Enrich each config with its latest run (status + size + when) for the card.
  return Promise.all(
    rows.map(async (r) => {
      const last = (
        await db
          .select()
          .from(dbBackups)
          .where(eq(dbBackups.configId, r.id))
          .orderBy(desc(dbBackups.startedAt))
          .limit(1)
      )[0];
      return toConfigView(
        r,
        last
          ? {
              status: last.status,
              sizeBytes: last.sizeBytes,
              finishedAt: last.finishedAt?.toISOString() ?? null,
            }
          : null,
      );
    }),
  );
}

export interface CreateBackupConfigInput {
  serverId: string;
  databaseId: string;
  schedule: string;
  keepNewest?: number;
  retentionDays?: number;
  dest: S3Destination;
  prefix?: string;
}

export async function createBackupConfig(
  db: Db,
  config: Env,
  orgId: string,
  input: CreateBackupConfigInput,
): Promise<BackupConfigView> {
  if (!isValidCron(input.schedule)) {
    throw new ValidationError("schedule must be a 5-field cron expression");
  }
  const server = (
    await db
      .select({ id: databaseServers.id })
      .from(databaseServers)
      .where(and(eq(databaseServers.id, input.serverId), eq(databaseServers.organizationId, orgId)))
      .limit(1)
  )[0];
  if (!server) throw new ValidationError("serverId does not reference a server in this org");
  const database = (
    await db
      .select({ id: databases.id, serverId: databases.serverId })
      .from(databases)
      .where(and(eq(databases.id, input.databaseId), eq(databases.organizationId, orgId)))
      .limit(1)
  )[0];
  if (!database || database.serverId !== input.serverId) {
    throw new ValidationError("databaseId does not reference a database on that server");
  }
  const sealed: SealedTarget = {
    dest: input.dest,
    ...(input.prefix ? { prefix: input.prefix } : {}),
  };
  const rows = await db
    .insert(dbBackupConfigs)
    .values({
      id: newId("bkc"),
      organizationId: orgId,
      serverId: input.serverId,
      databaseId: input.databaseId,
      schedule: input.schedule,
      keepNewest: input.keepNewest ?? 14,
      retentionDays: input.retentionDays ?? 14,
      target: "object_storage",
      targetRef: sealStr(JSON.stringify(sealed), config),
    })
    .returning();
  return toConfigView(rows[0]!);
}

const WAL_DRAIN_TIMEOUT_MS = 10 * 60_000;

/** Admin (replication-capable) target for a managed server: host/port from the
 *  row, user/password parsed from the sealed admin URL. */
function pitrTarget(server: typeof databaseServers.$inferSelect, config: Env): PgHostTarget {
  const u = new URL(openStr(server.adminSecretRef, config));
  return {
    host: server.host,
    port: server.port,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

export interface CreatePitrConfigInput {
  serverId: string;
  schedule: string; // base-backup cron
  walSchedule?: string; // WAL-drain cron (default every minute)
  keepNewest?: number;
  retentionDays?: number;
  dest: S3Destination;
  prefix?: string;
}

/** Enable PITR on a managed Postgres server: a server-level (databaseId=null)
 *  physical config that takes base backups on `schedule` and archives WAL on
 *  `walSchedule` via a dedicated replication slot. */
export async function createPitrConfig(
  db: Db,
  config: Env,
  orgId: string,
  input: CreatePitrConfigInput,
): Promise<BackupConfigView> {
  if (!isValidCron(input.schedule)) {
    throw new ValidationError("schedule must be a 5-field cron expression");
  }
  if (input.walSchedule && !isValidCron(input.walSchedule)) {
    throw new ValidationError("walSchedule must be a 5-field cron expression");
  }
  const server = (
    await db
      .select({ id: databaseServers.id, engine: databaseServers.engine })
      .from(databaseServers)
      .where(and(eq(databaseServers.id, input.serverId), eq(databaseServers.organizationId, orgId)))
      .limit(1)
  )[0];
  if (!server) throw new ValidationError("serverId does not reference a server in this org");
  if (server.engine !== "postgres") {
    throw new ValidationError("PITR is supported for Postgres servers only");
  }

  const id = newId("bkc");
  const slot = `shipsquares_pitr_${id.replace(/[^a-z0-9]/gi, "").toLowerCase()}`.slice(0, 63);
  const sealed: SealedTarget = {
    dest: input.dest,
    ...(input.prefix ? { prefix: input.prefix } : {}),
  };
  const rows = await db
    .insert(dbBackupConfigs)
    .values({
      id,
      organizationId: orgId,
      serverId: input.serverId,
      databaseId: null,
      type: "physical",
      schedule: input.schedule,
      walArchive: true,
      slotName: slot,
      walSchedule: input.walSchedule ?? "* * * * *",
      keepNewest: input.keepNewest ?? 14,
      retentionDays: input.retentionDays ?? 14,
      target: "object_storage",
      targetRef: sealStr(JSON.stringify(sealed), config),
    })
    .returning();
  return toConfigView(rows[0]!);
}

export async function deleteBackupConfig(
  db: Db,
  boss: PgBoss,
  orgId: string,
  id: string,
): Promise<void> {
  const rows = await db
    .delete(dbBackupConfigs)
    .where(and(eq(dbBackupConfigs.id, id), eq(dbBackupConfigs.organizationId, orgId)))
    .returning({ id: dbBackupConfigs.id });
  if (!rows[0]) throw new NotFoundError("backup config not found");
  await boss.unschedule(backupQueueName(id)).catch(() => undefined);
  await boss.unschedule(walQueueName(id)).catch(() => undefined);
}

export async function getBackupConfigRow(db: Db, orgId: string, id: string): Promise<ConfigRow> {
  const rows = await db
    .select()
    .from(dbBackupConfigs)
    .where(and(eq(dbBackupConfigs.id, id), eq(dbBackupConfigs.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("backup config not found");
  return rows[0];
}

export interface BackupRunView {
  id: string;
  status: string;
  location: string | null;
  sizeBytes: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export async function listBackupRuns(
  db: Db,
  orgId: string,
  configId: string,
): Promise<BackupRunView[]> {
  await getBackupConfigRow(db, orgId, configId); // 404 if cross-tenant
  const rows = await db
    .select()
    .from(dbBackups)
    .where(eq(dbBackups.configId, configId))
    .orderBy(desc(dbBackups.startedAt))
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    location: r.location,
    sizeBytes: r.sizeBytes,
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  }));
}

/** Execute one backup now via the TDD'd engine; never throws. */
export async function runBackupConfigNow(db: Db, config: Env, cfg: ConfigRow): Promise<void> {
  if (!cfg.databaseId || !cfg.targetRef) return;
  const database = (
    await db.select().from(databases).where(eq(databases.id, cfg.databaseId)).limit(1)
  )[0];
  const server = (
    await db.select().from(databaseServers).where(eq(databaseServers.id, cfg.serverId)).limit(1)
  )[0];
  if (!database || !server) return;
  const owner = (
    await db.select().from(databaseUsers).where(eq(databaseUsers.databaseId, database.id)).limit(1)
  )[0];
  if (!owner) return;

  const password = openStr(owner.passwordSecretRef, config);
  const target = JSON.parse(openStr(cfg.targetRef, config)) as SealedTarget;

  await runBackup(
    {
      dump: dumpCommandHost({
        host: server.host,
        port: server.port,
        user: owner.username,
        password,
        database: database.name,
      }),
      database: database.name,
      dest: target.dest,
      prefix: target.prefix ?? `${cfg.organizationId}/${database.name}`,
      keep: cfg.keepNewest,
      retentionMs: cfg.retentionDays * 24 * 60 * 60 * 1000,
    },
    {
      exec: async (command) =>
        runCommand("bash", ["-c", command], { timeoutMs: RUN_TIMEOUT_MS, env: BACKUP_EXEC_ENV }),
      record: {
        start: async () => {
          const id = newId("bkp");
          await db.insert(dbBackups).values({ id, configId: cfg.id });
          return id;
        },
        finish: async (id, patch) => {
          await db.update(dbBackups).set(patch).where(eq(dbBackups.id, id));
        },
      },
      now: () => new Date(),
    },
  );
}

/** Take a physical base backup of the whole cluster now (pg_basebackup → S3).
 *  Server-level; uses the server's admin (replication-capable) credentials. */
export async function runBaseBackupNow(db: Db, config: Env, cfg: ConfigRow): Promise<void> {
  if (cfg.type !== "physical" || !cfg.targetRef) return;
  const server = (
    await db.select().from(databaseServers).where(eq(databaseServers.id, cfg.serverId)).limit(1)
  )[0];
  if (!server || server.engine !== "postgres") return;
  const target = pitrTarget(server, config);
  const sealed = JSON.parse(openStr(cfg.targetRef, config)) as SealedTarget;
  const prefix = sealed.prefix ?? `${cfg.organizationId}/${cfg.serverId}`;
  const staging = `/var/lib/shipsquares/base/${cfg.id}`;

  await runBackup(
    {
      dump: baseBackupCommandHost(target, staging),
      database: "basebackup",
      ext: "tar",
      dest: sealed.dest,
      prefix: `${prefix}/base`,
      keep: cfg.keepNewest,
      retentionMs: cfg.retentionDays * 24 * 60 * 60 * 1000,
    },
    {
      exec: async (command) =>
        runCommand("bash", ["-c", command], { timeoutMs: RUN_TIMEOUT_MS, env: BACKUP_EXEC_ENV }),
      record: {
        start: async () => {
          const id = newId("bkp");
          await db.insert(dbBackups).values({ id, configId: cfg.id });
          return id;
        },
        finish: async (id, patch) => {
          await db.update(dbBackups).set(patch).where(eq(dbBackups.id, id));
        },
      },
      now: () => new Date(),
    },
  );
  // Remove the local staging (a full-cluster copy) after upload — best-effort.
  await runCommand("bash", ["-c", `rm -rf ${shq(staging)}`], { env: BACKUP_EXEC_ENV });
}

/** Drain WAL since the last run to S3 (the slot guarantees no gap between runs).
 *  Records the reached LSN + time on the config for status. Never throws. */
export async function runWalDrainNow(db: Db, config: Env, cfg: ConfigRow): Promise<void> {
  if (!cfg.walArchive || !cfg.slotName || !cfg.targetRef) return;
  const server = (
    await db.select().from(databaseServers).where(eq(databaseServers.id, cfg.serverId)).limit(1)
  )[0];
  if (!server || server.engine !== "postgres") return;
  const target = pitrTarget(server, config);
  const sealed = JSON.parse(openStr(cfg.targetRef, config)) as SealedTarget;
  const prefix = sealed.prefix ?? `${cfg.organizationId}/${cfg.serverId}`;

  const res = await runWalArchive(
    {
      target,
      slot: cfg.slotName,
      spoolDir: `/var/lib/shipsquares/wal/${cfg.id}`,
      dest: sealed.dest,
      walPrefix: `${prefix}/wal`,
    },
    {
      exec: async (command) =>
        runCommand("bash", ["-c", command], {
          timeoutMs: WAL_DRAIN_TIMEOUT_MS,
          env: BACKUP_EXEC_ENV,
        }),
    },
  );
  try {
    await db
      .update(dbBackupConfigs)
      .set({ lastWalAt: new Date(), ...(res.lsn ? { lastWalLsn: res.lsn } : {}) })
      .where(eq(dbBackupConfigs.id, cfg.id));
  } catch {
    // status update is best-effort
  }
}

/** Restore a successful run into its database — SYNCHRONOUS (the caller
 *  waits; 15-min cap). Destructive by design (pg_restore --clean): the route
 *  gates it behind server:write. The remote is recomposed from the sealed
 *  destination + the credential-free stored location. */
export async function restoreBackupRun(
  db: Db,
  config: Env,
  orgId: string,
  configId: string,
  runId: string,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = await getBackupConfigRow(db, orgId, configId);
  const run = (
    await db
      .select()
      .from(dbBackups)
      .where(and(eq(dbBackups.id, runId), eq(dbBackups.configId, cfg.id)))
      .limit(1)
  )[0];
  if (!run) throw new NotFoundError("backup run not found");
  if (run.status !== "success" || !run.location) {
    throw new ValidationError("only a successful run with a stored location can be restored");
  }
  if (!cfg.databaseId || !cfg.targetRef) {
    throw new ValidationError("backup config is missing its database or destination");
  }
  const database = (
    await db.select().from(databases).where(eq(databases.id, cfg.databaseId)).limit(1)
  )[0];
  const server = (
    await db.select().from(databaseServers).where(eq(databaseServers.id, cfg.serverId)).limit(1)
  )[0];
  const owner = database
    ? (
        await db
          .select()
          .from(databaseUsers)
          .where(eq(databaseUsers.databaseId, database.id))
          .limit(1)
      )[0]
    : undefined;
  if (!database || !server || !owner) {
    throw new ValidationError("the database behind this config no longer exists");
  }

  const target = JSON.parse(openStr(cfg.targetRef, config)) as SealedTarget;
  const command = restorePipelineHost(s3Remote(target.dest, run.location), {
    host: server.host,
    port: server.port,
    user: owner.username,
    password: openStr(owner.passwordSecretRef, config),
    database: database.name,
  });
  const res = await runCommand("bash", ["-c", command], {
    timeoutMs: 15 * 60_000,
    env: BACKUP_EXEC_ENV,
  });
  if (res.code !== 0) {
    const tail = res.lines
      .filter((l) => l.stream === "stderr")
      .slice(-5)
      .map((l) => l.line)
      .join("\n");
    return { ok: false, error: `restore failed (exit ${res.code})${tail ? `: ${tail}` : ""}` };
  }
  return { ok: true };
}

export interface RestorePlanInput {
  targetTime?: string;
  dataDir?: string;
  baseRunId?: string;
}

export interface RestorePlanView {
  base: { runId: string; location: string; finishedAt: string | null } | null;
  targetTime: string | null;
  dataDir: string;
  steps: { title: string; command: string }[];
  note: string;
}

/** Generate the PITR restore runbook (does NOT execute): pick the base (the
 *  named run, else the latest successful), then the ordered stop → wipe →
 *  extract → recovery-config → start steps an operator runs against an offline
 *  target. Automated one-click restore into a fresh cluster is a later sub-slice. */
export async function restorePlan(
  db: Db,
  config: Env,
  orgId: string,
  configId: string,
  input: RestorePlanInput,
): Promise<RestorePlanView> {
  const cfg = await getBackupConfigRow(db, orgId, configId);
  if (cfg.type !== "physical" || !cfg.targetRef) {
    throw new ValidationError("restore plans are available for PITR (physical) configs");
  }
  const sealed = JSON.parse(openStr(cfg.targetRef, config)) as SealedTarget;
  const prefix = sealed.prefix ?? `${cfg.organizationId}/${cfg.serverId}`;
  const base = input.baseRunId
    ? (
        await db
          .select()
          .from(dbBackups)
          .where(and(eq(dbBackups.id, input.baseRunId), eq(dbBackups.configId, cfg.id)))
          .limit(1)
      )[0]
    : (
        await db
          .select()
          .from(dbBackups)
          .where(and(eq(dbBackups.configId, cfg.id), eq(dbBackups.status, "success")))
          .orderBy(desc(dbBackups.startedAt))
          .limit(1)
      )[0];
  const dataDir = input.dataDir ?? "/var/lib/postgresql/data";
  const steps = base?.location
    ? restorePlanSteps({
        dest: sealed.dest,
        baseLocation: base.location,
        walPrefix: `${prefix}/wal`,
        dataDir,
        ...(input.targetTime ? { targetTime: input.targetTime } : {}),
      })
    : [];
  return {
    base: base?.location
      ? {
          runId: base.id,
          location: base.location,
          finishedAt: base.finishedAt?.toISOString() ?? null,
        }
      : null,
    targetTime: input.targetTime ?? null,
    dataDir,
    steps,
    note:
      "The manual runbook for an offline target. The recovery config embeds the S3 " +
      "credential into the target's postgresql.auto.conf — restrict access to that host. " +
      "Single-tablespace clusters. For an automated restore into a fresh container " +
      "(timeline-switch handled), use POST /backup-configs/:id/restore-run.",
  };
}

export interface RestoreToInstanceInput {
  targetTime?: string;
  baseRunId?: string;
  port?: number;
}

export interface RestoreToInstanceView {
  ok: boolean;
  container: string | null;
  port: number | null;
  pgVersion: string | null;
  recovered: boolean;
  error?: string;
}

/** Automated PITR restore into a FRESH postgres container (never touches the
 *  source): pick the base, stage base + WAL, replay to targetTime (or to the end
 *  of the archive), promote, and report the restored connection. Synchronous +
 *  best-effort (15-min cap). The container + staging persist for the operator to
 *  inspect / pg_dump / re-register; a re-run replaces them. */
export async function restoreToInstance(
  db: Db,
  config: Env,
  orgId: string,
  configId: string,
  input: RestoreToInstanceInput,
): Promise<RestoreToInstanceView> {
  const cfg = await getBackupConfigRow(db, orgId, configId);
  if (cfg.type !== "physical" || !cfg.targetRef) {
    throw new ValidationError("automated restore is available for PITR (physical) configs");
  }
  const sealed = JSON.parse(openStr(cfg.targetRef, config)) as SealedTarget;
  const prefix = sealed.prefix ?? `${cfg.organizationId}/${cfg.serverId}`;
  const base = input.baseRunId
    ? (
        await db
          .select()
          .from(dbBackups)
          .where(and(eq(dbBackups.id, input.baseRunId), eq(dbBackups.configId, cfg.id)))
          .limit(1)
      )[0]
    : (
        await db
          .select()
          .from(dbBackups)
          .where(and(eq(dbBackups.configId, cfg.id), eq(dbBackups.status, "success")))
          .orderBy(desc(dbBackups.startedAt))
          .limit(1)
      )[0];
  if (!base?.location) {
    throw new ValidationError("no successful base backup to restore from");
  }
  const res = await runRestore(
    {
      dest: sealed.dest,
      baseLocation: base.location,
      walPrefix: `${prefix}/wal`,
      stagingDir: `/var/lib/shipsquares/restore/${cfg.id}`,
      containerName: `ss-restore-${cfg.id}`,
      port: input.port ?? 55432,
      ...(input.targetTime ? { targetTime: input.targetTime } : {}),
    },
    {
      exec: (command) =>
        runCommand("bash", ["-c", command], { timeoutMs: 15 * 60_000, env: BACKUP_EXEC_ENV }),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
  );
  return {
    ok: res.ok,
    container: res.container ?? null,
    port: res.port ?? null,
    pgVersion: res.pgVersion ?? null,
    recovered: res.recovered ?? false,
    ...(res.error ? { error: res.error } : {}),
  };
}

// --- pg-boss cron (mirrors schedules.service) ---

export function backupQueueName(configId: string): string {
  return `backup:${configId}`;
}

export function walQueueName(configId: string): string {
  return `walarchive:${configId}`;
}

const workersRegistered = new Set<string>();

async function ensureWorker(db: Db, config: Env, boss: PgBoss, configId: string): Promise<void> {
  const qname = backupQueueName(configId);
  if (workersRegistered.has(qname)) return;
  workersRegistered.add(qname);
  await boss.work(qname, async () => {
    const fresh = (
      await db.select().from(dbBackupConfigs).where(eq(dbBackupConfigs.id, configId)).limit(1)
    )[0];
    if (!fresh?.enabled) return;
    if (fresh.type === "physical") await runBaseBackupNow(db, config, fresh);
    else await runBackupConfigNow(db, config, fresh);
  });
}

async function ensureWalWorker(db: Db, config: Env, boss: PgBoss, configId: string): Promise<void> {
  const qname = walQueueName(configId);
  if (workersRegistered.has(qname)) return;
  workersRegistered.add(qname);
  await boss.work(qname, async () => {
    const fresh = (
      await db.select().from(dbBackupConfigs).where(eq(dbBackupConfigs.id, configId)).limit(1)
    )[0];
    if (!fresh?.enabled || !fresh.walArchive) return;
    await runWalDrainNow(db, config, fresh);
  });
}

export async function syncBackupConfig(
  db: Db,
  config: Env,
  boss: PgBoss,
  cfg: ConfigRow,
): Promise<void> {
  const qname = backupQueueName(cfg.id);
  const wq = walQueueName(cfg.id);
  await boss.unschedule(qname).catch(() => undefined);
  await boss.unschedule(wq).catch(() => undefined);
  if (!cfg.enabled) return;
  // pg-boss v10: schedule/work throw on a queue that was never created.
  await boss.createQueue(qname);
  await boss.schedule(qname, cfg.schedule, {}, { tz: "UTC" });
  await ensureWorker(db, config, boss, cfg.id);
  if (cfg.walArchive) {
    await boss.createQueue(wq);
    await boss.schedule(wq, cfg.walSchedule ?? "* * * * *", {}, { tz: "UTC" });
    await ensureWalWorker(db, config, boss, cfg.id);
  }
}

export async function bootBackupConfigs(db: Db, config: Env, boss: PgBoss): Promise<number> {
  const rows = await db.select().from(dbBackupConfigs).where(eq(dbBackupConfigs.enabled, true));
  for (const cfg of rows) await syncBackupConfig(db, config, boss, cfg);
  return rows.length;
}
