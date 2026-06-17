import type { Env } from "@ss/shared";
import { and, desc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { apps, deployments } from "../db/schema/index.js";
import { parsePortMapping } from "../docker/ports.js";
import { convergeProxy } from "../proxy/caddy/converge.js";

import { firstStdout, runCommand } from "./exec.js";
import { containerName, type DeployMeta } from "./executor.js";

// App lifecycle controls (06-deploy-engine.md): stop / start / restart an app's
// running container(s) by label, with NO rebuild. Pairs with the live metrics
// running/stopped state (32-monitoring-metrics.md). Containers run under
// `--restart unless-stopped`, so a manual stop survives a daemon/VM reboot (stays
// stopped) until an explicit start, while a crash or reboot otherwise self-heals.

/** All of an app's container ids: single-run containers carry our label;
 *  compose-project containers carry only compose's project label — match the
 *  union so lifecycle works for both strategies. `includeStopped` (`ps -a`)
 *  is needed for `start` — a stopped container isn't listed by a plain `ps`. */
async function containerIds(appId: string, includeStopped: boolean): Promise<string[]> {
  const ids = new Set<string>();
  for (const filter of [
    `label=shipsquares.app=${appId}`,
    `label=com.docker.compose.project=${containerName(appId)}`,
  ]) {
    const out = await runCommand("docker", [
      "ps",
      includeStopped ? "-aq" : "-q",
      "--no-trunc",
      "--filter",
      filter,
    ]);
    for (const l of out.lines) {
      if (l.stream === "stdout" && l.line.trim()) ids.add(l.line.trim());
    }
  }
  return [...ids];
}

/** Stop the app's running container(s). No-op if nothing is running. The Caddy
 *  route is left as-is (it 502s while stopped) — `start` repairs it. */
export async function stopApp(appId: string): Promise<void> {
  const ids = await containerIds(appId, false);
  if (ids.length) await runCommand("docker", ["stop", ...ids]);
}

/** Restart the app's running container(s) in place. `docker restart` re-allocates
 *  the ephemeral host port, so the caller must `refreshAppRoute` afterwards. */
export async function restartApp(appId: string): Promise<void> {
  const ids = await containerIds(appId, false);
  if (ids.length) await runCommand("docker", ["restart", ...ids]);
}

/** Start the app's stopped container(s). Returns false when the app has no
 *  container at all (never deployed / removed) — the caller surfaces a 409. */
export async function startApp(appId: string): Promise<boolean> {
  const ids = await containerIds(appId, true);
  if (!ids.length) return false;
  await runCommand("docker", ["start", ...ids]);
  return true;
}

/** After a start/restart, Docker re-allocates the `-p 127.0.0.1::PORT` ephemeral
 *  host port, so the port recorded in the last deployment's meta (which the Caddy
 *  converge routes to) is now stale. Re-read the live port, update that meta, and
 *  reconverge so the app's domain follows the new port. Best-effort: no running
 *  container, no succeeded deployment, or no reachable Caddy/domain → no-op. */
export async function refreshAppRoute(db: Db, config: Env, appId: string): Promise<void> {
  const cids = await containerIds(appId, false);
  if (cids.length) {
    const appRow = (
      await db.select({ port: apps.port }).from(apps).where(eq(apps.id, appId)).limit(1)
    )[0];
    const containerPort = appRow?.port ?? 8080;
    // First container publishing the app port wins — in a compose project only
    // the exposed service maps it.
    let hostPort = "";
    for (const cid of cids) {
      const mapping = firstStdout(
        await runCommand("docker", ["port", cid, `${containerPort}/tcp`]),
      );
      hostPort = parsePortMapping(mapping) ?? "";
      if (hostPort) break;
    }
    if (hostPort) {
      const dep = (
        await db
          .select()
          .from(deployments)
          .where(and(eq(deployments.appId, appId), eq(deployments.status, "succeeded")))
          .orderBy(desc(deployments.finishedAt))
          .limit(1)
      )[0];
      if (dep) {
        const meta = {
          ...((dep.meta as DeployMeta) ?? {}),
          hostPort,
          url: `http://127.0.0.1:${hostPort}`,
        };
        await db
          .update(deployments)
          .set({ meta: meta as Record<string, unknown> })
          .where(eq(deployments.id, dep.id));
      }
    }
  }
  try {
    await convergeProxy(db, config);
  } catch {
    /* no caddy reachable or no domain yet — the lifecycle op still succeeded */
  }
}
