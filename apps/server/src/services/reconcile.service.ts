import type { Env } from "@ss/shared";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import type PgBoss from "pg-boss";

import type { Db } from "../db/index.js";
import { apps, deployments } from "../db/schema/index.js";
import { runCommand } from "../deploy/exec.js";
import { reconcileDecision } from "../docker/reconcile.js";
import { swallow } from "../lib/swallow.js";
import { ownersFromPs } from "../metrics/collector.js";

import { dispatchOutbound } from "./outbound-webhooks.service.js";

// Status reconcile (ROADMAP R2.3): every sweep compares docker truth to the
// DB's expectations — an app whose latest succeeded (non-preview) deployment
// implies a running container, but which has none, fires `app.unhealthy`
// through the signed outbound webhooks (once per cooldown). Crashed-app
// detection without an agent, the Dockge `compose ls` reconcile pattern.

export const RECONCILE_QUEUE = "status-reconcile";
const RECONCILE_CRON = "*/5 * * * *";
const COOLDOWN_MS = 30 * 60_000;
// A hung docker daemon must not wedge the pg-boss worker forever (M7).
const PS_TIMEOUT_MS = 15_000;

// In-process cooldown anchors (single control plane; resets on restart, which
// at worst re-pages once after a reboot — acceptable).
const lastNotified = new Map<string, number>();

export async function reconcileOnce(
  db: Db,
  config: Env,
): Promise<{ checked: number; drifted: number }> {
  // Docker truth: every running ss container, mapped to its app (label union).
  // If `docker ps` fails or times out we must NOT treat that as "nothing is
  // running" — that would page every app at once on a transient daemon hiccup.
  // Bail the pass instead (M7).
  const ps = await runCommand(
    "docker",
    [
      "ps",
      "--format",
      '{{.ID}}\t{{.Label "shipsquares.app"}}\t{{.Label "com.docker.compose.project"}}',
    ],
    { timeoutMs: PS_TIMEOUT_MS },
  ).catch(() => null);
  if (!ps || ps.code !== 0) {
    swallow("reconcile.docker_ps", new Error(`docker ps unavailable (skipping pass)`), "warn");
    return { checked: 0, drifted: 0 };
  }
  const running = new Set(
    ownersFromPs(ps.lines.filter((l) => l.stream === "stdout").map((l) => l.line)).map(
      (o) => o.appId,
    ),
  );

  // Only apps deployed to THIS control plane (serverId null) are covered by the
  // local `docker ps`; apps on remote workers would always read as absent here
  // and page forever (M6). Per-server SSH probing is the R4.3 server-health job.
  const allApps = await db.select().from(apps).where(isNull(apps.serverId));
  const now = Date.now();
  let drifted = 0;
  for (const app of allApps) {
    const latest = (
      await db
        .select({ id: deployments.id, finishedAt: deployments.finishedAt })
        .from(deployments)
        .where(
          and(
            eq(deployments.appId, app.id),
            eq(deployments.status, "succeeded"),
            ne(deployments.trigger, "preview"),
          ),
        )
        .orderBy(desc(deployments.finishedAt))
        .limit(1)
    )[0];
    const decision = reconcileDecision({
      expectedRunning: latest !== undefined,
      actuallyRunning: running.has(app.id),
      lastNotifiedAt: lastNotified.get(app.id) ?? null,
      cooldownMs: COOLDOWN_MS,
      now,
    });
    if (decision !== "notify") continue;
    drifted += 1;
    lastNotified.set(app.id, now);
    void dispatchOutbound(db, config, app.organizationId, "app.unhealthy", {
      app: { id: app.id, name: app.name },
      lastSuccessfulDeploymentId: latest?.id ?? null,
      detail: "no running container for the latest succeeded deployment",
      at: new Date(now).toISOString(),
    }).catch((e) => swallow("reconcile.notify_unhealthy", e));
  }
  return { checked: allApps.length, drifted };
}

/** Register the reconcile cron + worker (idempotent; non-fatal without pg-boss). */
export async function bootReconcile(db: Db, config: Env, boss: PgBoss): Promise<void> {
  await boss.createQueue(RECONCILE_QUEUE);
  await boss.unschedule(RECONCILE_QUEUE).catch(() => undefined);
  await boss.schedule(RECONCILE_QUEUE, RECONCILE_CRON, {}, { tz: "UTC" });
  await boss.work(RECONCILE_QUEUE, async () => {
    await reconcileOnce(db, config);
  });
}
