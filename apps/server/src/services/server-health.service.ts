/**
 * Server health service (R4.3). A pg-boss cron job that probes all worker
 * servers over SSH, checking docker/disk and updating the server status FSM.
 * Unreachable servers transition ready→unreachable; recovered servers
 * transition unreachable→ready.
 */

import type { Env } from "@ss/shared";
import { eq, ne } from "drizzle-orm";
import type PgBoss from "pg-boss";

import type { Db } from "../db/index.js";
import { servers } from "../db/schema/index.js";
import { loadMasterKey, open } from "../secrets/crypto.js";
import type { SealedValue } from "../secrets/types.js";
import {
  decideServerStatus,
  parseDockerVersion,
  parseDiskUsage,
  type HealthProbeResult,
} from "../servers/health-probe.js";
import { sshPool } from "../ssh/pool.js";

export const SERVER_HEALTH_QUEUE = "server-health";
const SERVER_HEALTH_CRON = "*/5 * * * *"; // Every 5 minutes

/** Probe a single server over SSH, returning health results. */
async function probeServer(
  host: string,
  port: number,
  username: string,
  privateKey: string,
): Promise<HealthProbeResult> {
  const target = { host, port, username, privateKey };

  try {
    // Probe docker
    const dockerResult = await sshPool.exec(
      target,
      "docker version --format '{{.Server.Version}}'",
      { timeoutMs: 10_000 },
    );
    const dockerOutput = dockerResult.lines
      .filter((l) => l.stream === "stdout")
      .map((l) => l.line)
      .join("\n");
    const docker = parseDockerVersion(dockerOutput, dockerResult.code);

    // Probe disk
    const diskResult = await sshPool.exec(target, "df -kP /", { timeoutMs: 10_000 });
    const diskOutput = diskResult.lines
      .filter((l) => l.stream === "stdout")
      .map((l) => l.line)
      .join("\n");
    const disk = parseDiskUsage(diskOutput, diskResult.code);

    return { reachable: true, docker, disk };
  } catch (err) {
    // SSH connection failed — server unreachable
    return {
      reachable: false,
      docker: { ok: false, error: String(err) },
      disk: { ok: false, error: String(err) },
    };
  }
}

/**
 * Run health checks on all worker servers. Updates status FSM and lastCheckedAt.
 * Returns stats for logging.
 */
export async function runHealthChecks(
  db: Db,
  config: Env,
): Promise<{ checked: number; unreachable: number; recovered: number; errored: number }> {
  // Only check workers that have been bootstrapped (have an SSH key)
  // and are not in the middle of being added/bootstrapped
  const workerRows = await db.select().from(servers).where(ne(servers.role, "control"));

  const masterKey = loadMasterKey(config.SHIPSQUARES_MASTER_KEY);
  const stats = { checked: 0, unreachable: 0, recovered: 0, errored: 0 };

  for (const row of workerRows) {
    // Skip servers without SSH keys (not yet provisioned)
    if (!row.sshRef) continue;

    // Skip servers still being added/bootstrapped
    if (row.status === "adding" || row.status === "bootstrapping") continue;

    stats.checked++;

    try {
      const privateKey = open(JSON.parse(row.sshRef) as SealedValue, masterKey);
      const probe = await probeServer(row.host, row.sshPort, row.sshUser, privateKey);
      const newStatus = decideServerStatus(row.status, probe);

      // Update server with probe results
      const updateSet: Partial<typeof servers.$inferInsert> = {
        lastCheckedAt: new Date(),
        dockerOk: probe.docker.ok,
      };

      if (newStatus) {
        updateSet.status = newStatus;
        if (newStatus === "unreachable") stats.unreachable++;
        else if (newStatus === "ready") stats.recovered++;
        else if (newStatus === "error") stats.errored++;
      }

      await db.update(servers).set(updateSet).where(eq(servers.id, row.id));
    } catch {
      // Failed to unseal key or other error — don't crash the sweep
      stats.errored++;
    }
  }

  return stats;
}

/**
 * Register the server health cron job (idempotent; non-fatal without pg-boss).
 */
export async function bootServerHealth(db: Db, config: Env, boss: PgBoss): Promise<void> {
  await boss.createQueue(SERVER_HEALTH_QUEUE);
  await boss.unschedule(SERVER_HEALTH_QUEUE).catch(() => undefined);
  await boss.schedule(SERVER_HEALTH_QUEUE, SERVER_HEALTH_CRON, {}, { tz: "UTC" });
  await boss.work(SERVER_HEALTH_QUEUE, async () => {
    await runHealthChecks(db, config);
  });
}
