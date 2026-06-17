import { NotFoundError, ValidationError, newId } from "@ss/shared";
import { and, eq, gte } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { apps, metricAlerts, metricSamples, servers } from "../db/schema/index.js";
import { type Bucket, bucketSamples } from "../metrics/bucket.js";

// Metrics read API + alert CRUD (ROADMAP R1.2/R1.3). Series are bucketed via
// the tested metrics/bucket core so charts get ≤ a few hundred points
// regardless of range; alerts are org-scoped rows the collector evaluates.

const RANGES: Record<string, { ms: number; stepMs: number }> = {
  "1h": { ms: 60 * 60_000, stepMs: 60_000 },
  "24h": { ms: 24 * 60 * 60_000, stepMs: 10 * 60_000 },
  "7d": { ms: 7 * 24 * 60 * 60_000, stepMs: 60 * 60_000 },
};

export type SeriesMetric = "cpu" | "mem";

export interface SeriesResult {
  metric: SeriesMetric;
  range: string;
  stepMs: number;
  points: Bucket[];
  /** mem only: the latest observed limit, for a "vs limit" overlay */
  memLimitBytes: number | null;
}

export async function appSeries(
  db: Db,
  orgId: string,
  appId: string,
  metric: SeriesMetric,
  range: string,
): Promise<SeriesResult> {
  const app = (
    await db
      .select({ id: apps.id })
      .from(apps)
      .where(and(eq(apps.id, appId), eq(apps.organizationId, orgId)))
      .limit(1)
  )[0];
  if (!app) throw new NotFoundError("app not found");
  const r = RANGES[range];
  if (!r) throw new ValidationError("range must be one of 1h, 24h, 7d");

  const rows = await db
    .select()
    .from(metricSamples)
    .where(
      and(
        eq(metricSamples.scope, "app"),
        eq(metricSamples.appId, appId),
        gte(metricSamples.ts, new Date(Date.now() - r.ms)),
      ),
    );
  const samples = rows
    .map((s) => ({
      ts: s.ts.getTime(),
      value:
        metric === "cpu"
          ? s.cpuPct
          : s.memBytes !== null && s.memLimitBytes
            ? (s.memBytes / s.memLimitBytes) * 100
            : null,
    }))
    .filter((s): s is { ts: number; value: number } => s.value !== null);
  const latestLimit = rows
    .filter((s) => s.memLimitBytes !== null)
    .sort((a, b) => b.ts.getTime() - a.ts.getTime())[0]?.memLimitBytes;

  return {
    metric,
    range,
    stepMs: r.stepMs,
    points: bucketSamples(samples, r.stepMs),
    memLimitBytes: latestLimit ?? null,
  };
}

export type ServerSeriesMetric = "cpu" | "mem" | "disk";

export interface ServerSeriesResult {
  metric: ServerSeriesMetric;
  range: string;
  stepMs: number;
  points: Bucket[];
  /** mem: total bytes; disk: total bytes */
  limitBytes: number | null;
}

/**
 * Server-scope metrics series (R1 tail). For serverId="host", returns the
 * control server metrics (rows with null serverId). For a worker server id,
 * validates org ownership first.
 */
export async function serverSeries(
  db: Db,
  orgId: string,
  serverId: string,
  metric: ServerSeriesMetric,
  range: string,
): Promise<ServerSeriesResult> {
  const r = RANGES[range];
  if (!r) throw new ValidationError("range must be one of 1h, 24h, 7d");

  // "host" = control server (serverId is null in metric_samples)
  if (serverId !== "host") {
    const srv = (
      await db
        .select({ id: servers.id })
        .from(servers)
        .where(and(eq(servers.id, serverId), eq(servers.organizationId, orgId)))
        .limit(1)
    )[0];
    if (!srv) throw new NotFoundError("server not found");
  }

  const { isNull } = await import("drizzle-orm");
  const serverFilter =
    serverId === "host" ? isNull(metricSamples.serverId) : eq(metricSamples.serverId, serverId);

  const rows = await db
    .select()
    .from(metricSamples)
    .where(
      and(
        eq(metricSamples.scope, "server"),
        serverFilter,
        gte(metricSamples.ts, new Date(Date.now() - r.ms)),
      ),
    );

  const samples = rows
    .map((s) => {
      let value: number | null = null;
      if (metric === "cpu") value = s.cpuPct;
      else if (metric === "mem" && s.memBytes !== null && s.memLimitBytes)
        value = (s.memBytes / s.memLimitBytes) * 100;
      else if (metric === "disk" && s.diskBytes !== null && s.diskTotalBytes)
        value = (s.diskBytes / s.diskTotalBytes) * 100;
      return { ts: s.ts.getTime(), value };
    })
    .filter((s): s is { ts: number; value: number } => s.value !== null);

  // Get latest limit for the overlay
  let limitBytes: number | null = null;
  if (metric === "mem") {
    limitBytes =
      rows
        .filter((s) => s.memLimitBytes !== null)
        .sort((a, b) => b.ts.getTime() - a.ts.getTime())[0]?.memLimitBytes ?? null;
  } else if (metric === "disk") {
    limitBytes =
      rows
        .filter((s) => s.diskTotalBytes !== null)
        .sort((a, b) => b.ts.getTime() - a.ts.getTime())[0]?.diskTotalBytes ?? null;
  }

  return {
    metric,
    range,
    stepMs: r.stepMs,
    points: bucketSamples(samples, r.stepMs),
    limitBytes,
  };
}

type AlertRow = typeof metricAlerts.$inferSelect;

export interface MetricAlertView {
  id: string;
  scope: "server" | "app";
  targetId: string;
  metric: string;
  thresholdPct: number;
  windowSeconds: number;
  enabled: boolean;
  lastFiredAt: string | null;
  createdAt: string;
}

function toView(r: AlertRow): MetricAlertView {
  return {
    id: r.id,
    scope: r.scope as "server" | "app",
    targetId: r.targetId,
    metric: r.metric,
    thresholdPct: r.thresholdPct,
    windowSeconds: r.windowSeconds,
    enabled: r.enabled,
    lastFiredAt: r.lastFiredAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listMetricAlerts(db: Db, orgId: string): Promise<MetricAlertView[]> {
  const rows = await db.select().from(metricAlerts).where(eq(metricAlerts.organizationId, orgId));
  return rows.map(toView);
}

export interface CreateMetricAlertInput {
  scope: "server" | "app";
  targetId: string;
  metric: "cpu" | "mem";
  thresholdPct: number;
  windowSeconds?: number;
}

export async function createMetricAlert(
  db: Db,
  orgId: string,
  input: CreateMetricAlertInput,
): Promise<MetricAlertView> {
  if (input.scope === "app") {
    const app = (
      await db
        .select({ id: apps.id })
        .from(apps)
        .where(and(eq(apps.id, input.targetId), eq(apps.organizationId, orgId)))
        .limit(1)
    )[0];
    if (!app) throw new ValidationError("targetId does not reference an app in this org");
  } else if (input.targetId !== "host") {
    const srv = (
      await db
        .select({ id: servers.id })
        .from(servers)
        .where(and(eq(servers.id, input.targetId), eq(servers.organizationId, orgId)))
        .limit(1)
    )[0];
    if (!srv) {
      throw new ValidationError('targetId must be a server in this org, or "host"');
    }
  }
  const rows = await db
    .insert(metricAlerts)
    .values({
      id: newId("malert"),
      organizationId: orgId,
      scope: input.scope,
      targetId: input.targetId,
      metric: input.metric,
      thresholdPct: input.thresholdPct,
      windowSeconds: input.windowSeconds ?? 300,
    })
    .returning();
  return toView(rows[0]!);
}

export async function deleteMetricAlert(db: Db, orgId: string, id: string): Promise<void> {
  const rows = await db
    .delete(metricAlerts)
    .where(and(eq(metricAlerts.id, id), eq(metricAlerts.organizationId, orgId)))
    .returning({ id: metricAlerts.id });
  if (!rows[0]) throw new NotFoundError("metric alert not found");
}
