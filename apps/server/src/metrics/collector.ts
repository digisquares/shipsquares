import os from "node:os";

import type { Env } from "@ss/shared";
import { and, eq, gte, isNull, lt } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { metricAlerts, metricSamples } from "../db/schema/index.js";
import { runCommand } from "../deploy/exec.js";
import { dispatchOutbound } from "../services/outbound-webhooks.service.js";

import { evaluateAlert } from "./alerts.js";
import { hostCpuPct, parseDfRoot, parseDockerStatsLine } from "./stats-parse.js";

// The metrics collector (ROADMAP R1.1/R1.3): every INTERVAL it samples the
// host (cpu/mem/disk) and every ss-labeled container (one batched `docker
// stats`), persists metric_samples, trims past retention, then evaluates the
// threshold alerts — firing through the signed outbound webhooks
// (`server.threshold`). Single-process, best-effort: a failed tick logs and
// the next tick runs.

const INTERVAL_MS = 60_000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface ContainerOwner {
  id: string;
  appId: string;
}

/** docker ps line "ID<TAB>app-label<TAB>compose-project" → container→app. */
export function ownersFromPs(lines: string[]): ContainerOwner[] {
  const owners: ContainerOwner[] = [];
  for (const line of lines) {
    const [id, label, project] = line.split("\t").map((s) => s?.trim() ?? "");
    if (!id) continue;
    // Single-run containers carry our label; compose containers carry only
    // the project label "ss-<appid>" (app ids are already lowercase).
    const appId = label || (project?.startsWith("ss-") ? project.slice(3) : "");
    if (appId) owners.push({ id, appId });
  }
  return owners;
}

async function collectOnce(db: Db): Promise<void> {
  const now = new Date();
  const rows: (typeof metricSamples.$inferInsert)[] = [];

  // ── host sample (the control server; serverId null = this host) ──────────
  const df = parseDfRoot(
    (await runCommand("df", ["-kP", "/"]).catch(() => ({ lines: [] }))).lines
      .filter((l) => l.stream === "stdout")
      .map((l) => l.line)
      .join("\n"),
  );
  rows.push({
    scope: "server",
    ts: now,
    cpuPct: hostCpuPct(os.loadavg()[0] ?? 0, os.cpus().length),
    memBytes: os.totalmem() - os.freemem(),
    memLimitBytes: os.totalmem(),
    ...(df ? { diskBytes: df.usedBytes, diskTotalBytes: df.totalBytes } : {}),
  });

  // ── per-app container samples (one ps + one batched stats call) ──────────
  const ps = await runCommand("docker", [
    "ps",
    "--format",
    '{{.ID}}\t{{.Label "shipsquares.app"}}\t{{.Label "com.docker.compose.project"}}',
  ]).catch(() => ({ lines: [] as { stream: string; line: string }[] }));
  const owners = ownersFromPs(ps.lines.filter((l) => l.stream === "stdout").map((l) => l.line));
  if (owners.length) {
    const stats = await runCommand("docker", [
      "stats",
      "--no-stream",
      "--format",
      "{{json .}}",
      ...owners.map((o) => o.id),
    ]).catch(() => ({ lines: [] as { stream: string; line: string }[] }));
    const byId = new Map(owners.map((o) => [o.id, o.appId]));
    // docker truncates ids in stats output — match by prefix.
    const perApp = new Map<string, { cpu: number; mem: number; limit: number }>();
    for (const l of stats.lines) {
      if (l.stream !== "stdout") continue;
      const s = parseDockerStatsLine(l.line);
      if (!s) continue;
      const appId = [...byId.entries()].find(
        ([id]) => id.startsWith(s.id) || s.id.startsWith(id),
      )?.[1];
      if (!appId) continue;
      const agg = perApp.get(appId) ?? { cpu: 0, mem: 0, limit: 0 };
      agg.cpu += s.cpuPct;
      agg.mem += s.memBytes ?? 0;
      agg.limit += s.memLimitBytes ?? 0;
      perApp.set(appId, agg);
    }
    for (const [appId, agg] of perApp) {
      rows.push({
        scope: "app",
        appId,
        ts: now,
        cpuPct: agg.cpu,
        memBytes: agg.mem,
        ...(agg.limit ? { memLimitBytes: agg.limit } : {}),
      });
    }
  }

  if (rows.length) await db.insert(metricSamples).values(rows);
  await db
    .delete(metricSamples)
    .where(lt(metricSamples.ts, new Date(now.getTime() - RETENTION_MS)))
    .catch(() => undefined);
}

/** Evaluate every enabled alert against its window; fire → outbound webhooks
 *  (`server.threshold`) + cooldown stamp. */
export async function evaluateAlerts(db: Db, config: Env): Promise<void> {
  const alerts = await db.select().from(metricAlerts).where(eq(metricAlerts.enabled, true));
  if (!alerts.length) return;
  const now = Date.now();
  for (const alert of alerts) {
    const since = new Date(now - alert.windowSeconds * 1000);
    const where =
      alert.scope === "app"
        ? and(
            eq(metricSamples.scope, "app"),
            eq(metricSamples.appId, alert.targetId),
            gte(metricSamples.ts, since),
          )
        : and(
            eq(metricSamples.scope, "server"),
            // "host" = the control box itself (rows carry a null serverId)
            alert.targetId === "host"
              ? isNull(metricSamples.serverId)
              : eq(metricSamples.serverId, alert.targetId),
            gte(metricSamples.ts, since),
          );
    const samples = await db.select().from(metricSamples).where(where);
    // cpu|mem|disk — disk now has diskTotalBytes (R1 tail complete)
    const values = samples
      .map((s) => {
        if (alert.metric === "cpu") return s.cpuPct;
        if (alert.metric === "mem") {
          return s.memBytes !== null && s.memLimitBytes
            ? (s.memBytes / s.memLimitBytes) * 100
            : null;
        }
        if (alert.metric === "disk") {
          return s.diskBytes !== null && s.diskTotalBytes
            ? (s.diskBytes / s.diskTotalBytes) * 100
            : null;
        }
        return null;
      })
      .filter((v): v is number => v !== null && Number.isFinite(v));

    const decision = evaluateAlert({
      values,
      thresholdPct: alert.thresholdPct,
      lastFiredAt: alert.lastFiredAt?.getTime() ?? null,
      windowMs: alert.windowSeconds * 1000,
      now,
    });
    if (decision !== "fire") continue;

    await db
      .update(metricAlerts)
      .set({ lastFiredAt: new Date(now) })
      .where(eq(metricAlerts.id, alert.id));
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    void dispatchOutbound(db, config, alert.organizationId, "server.threshold", {
      alert: {
        id: alert.id,
        scope: alert.scope,
        targetId: alert.targetId,
        metric: alert.metric,
        thresholdPct: alert.thresholdPct,
        windowSeconds: alert.windowSeconds,
      },
      observedAvgPct: Math.round(avg * 10) / 10,
      at: new Date(now).toISOString(),
    }).catch(() => undefined);
  }
}

/** Boot the 60s collect→trim→evaluate loop. Returns a stop function. */
export function startCollector(db: Db, config: Env): () => void {
  const tick = async (): Promise<void> => {
    try {
      await collectOnce(db);
      await evaluateAlerts(db, config);
    } catch {
      // best-effort: a failed tick must never crash the control plane
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
