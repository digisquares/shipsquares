import "dotenv/config";

import { loadConfig } from "@ss/shared";

import { buildApp } from "./app.js";
import { sweepStaleDeployments } from "./deploy/sweep.js";
import { convergeProxy } from "./proxy/caddy/converge.js";

// Load + validate config exactly once; a missing/malformed env crashes here,
// before any listener is opened (02-foundations.md).
const config = loadConfig();
const app = await buildApp();

try {
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  console.log(`ShipSquares control plane listening on :${config.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Start the job queue (its own `pgboss` schema; jobs land with 06). Non-fatal in
// dev: the API works without it until queued work exists.
try {
  await app.queue.start();
  console.log("pg-boss job queue started (schema: pgboss)");
} catch (err) {
  console.warn(`pg-boss start skipped: ${(err as Error).message}`);
}

// Re-register every enabled schedule's cron + worker (29). Non-fatal without
// the queue (dev).
try {
  const { bootSchedules } = await import("./services/schedules.service.js");
  const n = await bootSchedules(app.db, app.queue);
  if (n > 0) console.log(`registered ${n} scheduled job(s) on pg-boss cron`);
} catch (err) {
  console.warn(`schedule registration skipped: ${(err as Error).message}`);
}

// Deploy queue consumer (06): queued deployments survive restarts and are
// redelivered here. Non-fatal in dev (inline fallback covers dispatch).
try {
  const { DEPLOY_QUEUE } = await import("./deploy/dispatch.js");
  const { executeDeploy } = await import("./deploy/executor.js");
  // pg-boss v10: queues must exist before send/work — a send to a missing
  // queue silently drops the job (found on the VM: deployments sat queued
  // forever). createQueue is an idempotent upsert.
  await app.queue.createQueue(DEPLOY_QUEUE);
  await app.queue.work<{
    deploymentId: string;
    image?: string;
    preview?: { prNumber: number; branch: string };
  }>(DEPLOY_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await executeDeploy(app.db, job.data.deploymentId, {
        ...(job.data.image ? { image: job.data.image } : {}),
        ...(job.data.preview ? { preview: job.data.preview } : {}),
      });
    }
  });
} catch (err) {
  console.warn(`deploy worker registration skipped: ${(err as Error).message}`);
}

// Preview sweeper (31): hourly teardown of stuck/aged previews. Non-fatal.
try {
  const { bootPreviewSweeper } = await import("./previews/sweeper.js");
  await bootPreviewSweeper(app.db, config, app.queue);
} catch (err) {
  console.warn(`preview sweeper registration skipped: ${(err as Error).message}`);
}

// Re-register enabled backup configs on pg-boss cron (27). Non-fatal in dev.
try {
  const { bootBackupConfigs } = await import("./services/backups.service.js");
  const n = await bootBackupConfigs(app.db, config, app.queue);
  if (n > 0) console.log(`registered ${n} backup config(s) on pg-boss cron`);
} catch (err) {
  console.warn(`backup registration skipped: ${(err as Error).message}`);
}

// Restart recovery: fail any deployment stranded queued|running by a previous
// process — nothing would ever finish it, and it blocks new deploys under the
// one-active-per-app rule.
try {
  const swept = await sweepStaleDeployments(app.db);
  if (swept > 0) console.log(`marked ${swept} stale deployment(s) failed (restart recovery)`);
} catch (err) {
  console.warn(`stale-deployment sweep skipped: ${(err as Error).message}`);
}

// Status reconcile (ROADMAP R2.3): every 5m, docker truth vs DB expectations;
// a should-be-running app with no container fires app.unhealthy. Non-fatal.
try {
  const { bootReconcile } = await import("./services/reconcile.service.js");
  await bootReconcile(app.db, config, app.queue);
  console.log("status-reconcile cron registered (*/5)");
} catch (err) {
  console.warn(`status-reconcile registration skipped: ${(err as Error).message}`);
}

// Cross-process realtime (ROADMAP R2.4): mirror the bus over pg NOTIFY so a
// future multi-instance control plane fans out logs/status. Non-fatal.
try {
  const { startPgBridge } = await import("./realtime/pg-bridge.js");
  await startPgBridge(config.DATABASE_URL);
  console.log("realtime pg-bridge listening (ss_bus)");
} catch (err) {
  console.warn(`realtime pg-bridge skipped: ${(err as Error).message}`);
}

// Git-poll fallback (ROADMAP R2.1): webhookless auto-deploy for opted-in
// apps — one cron sweep comparing ls-remote to the deployed commit. Non-fatal.
try {
  const { bootGitPoll } = await import("./services/git-poll.service.js");
  await bootGitPoll(app.db, config, app.queue);
  console.log("git-poll cron registered (*/2)");
} catch (err) {
  console.warn(`git-poll registration skipped: ${(err as Error).message}`);
}

// Server health (ROADMAP R4.3): every 5m, probe worker servers over SSH
// checking docker/disk and updating the server status FSM. Non-fatal.
try {
  const { bootServerHealth } = await import("./services/server-health.service.js");
  await bootServerHealth(app.db, config, app.queue);
  console.log("server-health cron registered (*/5)");
} catch (err) {
  console.warn(`server-health registration skipped: ${(err as Error).message}`);
}

// Mail DNS verification (ROADMAP R(mail).1): every 2m, resolve the required
// records for domains awaiting verification and advance the state machine. Non-fatal.
try {
  const { bootMailDnsVerify } = await import("./services/mail-dns-verify.service.js");
  await bootMailDnsVerify(app.db, app.queue);
  console.log("mail-dns-verify cron registered (*/2)");
} catch (err) {
  console.warn(`mail-dns-verify registration skipped: ${(err as Error).message}`);
}

// Metrics collector (ROADMAP R1): 60s host+container sampling into
// metric_samples, retention trim, threshold-alert evaluation. Non-fatal.
try {
  const { startCollector } = await import("./metrics/collector.js");
  startCollector(app.db, config);
  console.log("metrics collector started (60s interval)");
} catch (err) {
  console.warn(`metrics collector skipped: ${(err as Error).message}`);
}

// Converge Caddy to the DB state — the control-plane's own edge route plus a
// route for every app domain with a running container (08-proxy-ssl.md).
// Non-fatal: a dev run without Caddy simply serves on the local port.
if (config.PROXY_DRIVER === "caddy") {
  try {
    await convergeProxy(app.db, config);
    console.log("converged Caddy routes (control plane + deployed app domains)");
  } catch (err) {
    console.warn(`caddy converge skipped: ${(err as Error).message}`);
  }
}
