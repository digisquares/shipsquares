/**
 * Prometheus metrics formatter (R6.4). Exposes platform metrics in the
 * standard Prometheus exposition format for external monitoring systems.
 */

import os from "node:os";

import { and, count, eq, gte, isNull } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { apps, deployments, metricSamples, servers } from "../db/schema/index.js";

export interface PrometheusMetric {
  name: string;
  type: "gauge" | "counter" | "histogram" | "summary";
  help: string;
  values: Array<{ labels: Record<string, string>; value: number }>;
}

/**
 * Collect all platform metrics for Prometheus export.
 */
export async function collectPrometheusMetrics(db: Db): Promise<PrometheusMetric[]> {
  const metrics: PrometheusMetric[] = [];
  const now = Date.now();
  const fiveMinAgo = new Date(now - 5 * 60 * 1000);

  // ── Host metrics ──────────────────────────────────────────────────────────
  const loadAvg = os.loadavg();
  const cpuCount = os.cpus().length;

  metrics.push({
    name: "shipsquares_host_cpu_usage_ratio",
    type: "gauge",
    help: "Host CPU usage as a ratio (0-1) based on 1-minute load average",
    values: [{ labels: {}, value: Math.min(loadAvg[0]! / cpuCount, 1) }],
  });

  metrics.push({
    name: "shipsquares_host_memory_used_bytes",
    type: "gauge",
    help: "Host memory used in bytes",
    values: [{ labels: {}, value: os.totalmem() - os.freemem() }],
  });

  metrics.push({
    name: "shipsquares_host_memory_total_bytes",
    type: "gauge",
    help: "Host total memory in bytes",
    values: [{ labels: {}, value: os.totalmem() }],
  });

  metrics.push({
    name: "shipsquares_host_uptime_seconds",
    type: "gauge",
    help: "Host uptime in seconds",
    values: [{ labels: {}, value: os.uptime() }],
  });

  // ── Platform counts ───────────────────────────────────────────────────────
  const [appCount] = await db.select({ count: count() }).from(apps);
  metrics.push({
    name: "shipsquares_apps_total",
    type: "gauge",
    help: "Total number of apps across all organizations",
    values: [{ labels: {}, value: appCount?.count ?? 0 }],
  });

  const [serverCount] = await db.select({ count: count() }).from(servers);
  metrics.push({
    name: "shipsquares_servers_total",
    type: "gauge",
    help: "Total number of servers across all organizations",
    values: [{ labels: {}, value: serverCount?.count ?? 0 }],
  });

  // Server status breakdown
  const serverStatuses = await db
    .select({ status: servers.status, count: count() })
    .from(servers)
    .groupBy(servers.status);

  const statusCounts: Record<string, number> = {};
  for (const row of serverStatuses) {
    statusCounts[row.status] = row.count;
  }

  metrics.push({
    name: "shipsquares_servers_by_status",
    type: "gauge",
    help: "Number of servers by status",
    values: ["adding", "bootstrapping", "ready", "error", "unreachable"].map((status) => ({
      labels: { status },
      value: statusCounts[status] ?? 0,
    })),
  });

  // ── Deployment metrics ────────────────────────────────────────────────────
  // Recent deployments (last 5 minutes) by status
  const recentDeploys = await db
    .select({ status: deployments.status, count: count() })
    .from(deployments)
    .where(gte(deployments.queuedAt, fiveMinAgo))
    .groupBy(deployments.status);

  const deployCounts: Record<string, number> = {};
  for (const row of recentDeploys) {
    deployCounts[row.status] = row.count;
  }

  metrics.push({
    name: "shipsquares_deployments_recent",
    type: "gauge",
    help: "Number of deployments in the last 5 minutes by status",
    values: ["queued", "running", "succeeded", "failed", "cancelled"].map((status) => ({
      labels: { status },
      value: deployCounts[status] ?? 0,
    })),
  });

  // ── App metrics from metric_samples ───────────────────────────────────────
  // Latest sample per app (within last 2 minutes for freshness)
  const twoMinAgo = new Date(now - 2 * 60 * 1000);
  const latestAppSamples = await db
    .select()
    .from(metricSamples)
    .where(and(eq(metricSamples.scope, "app"), gte(metricSamples.ts, twoMinAgo)));

  // Aggregate by app (take most recent sample per app)
  const appSamples = new Map<string, typeof metricSamples.$inferSelect>();
  for (const sample of latestAppSamples) {
    if (!sample.appId) continue;
    const existing = appSamples.get(sample.appId);
    if (!existing || sample.ts > existing.ts) {
      appSamples.set(sample.appId, sample);
    }
  }

  const cpuValues: Array<{ labels: Record<string, string>; value: number }> = [];
  const memValues: Array<{ labels: Record<string, string>; value: number }> = [];
  const memLimitValues: Array<{ labels: Record<string, string>; value: number }> = [];

  for (const [appId, sample] of appSamples) {
    if (sample.cpuPct !== null) {
      cpuValues.push({ labels: { app_id: appId }, value: sample.cpuPct });
    }
    if (sample.memBytes !== null) {
      memValues.push({ labels: { app_id: appId }, value: sample.memBytes });
    }
    if (sample.memLimitBytes !== null) {
      memLimitValues.push({ labels: { app_id: appId }, value: sample.memLimitBytes });
    }
  }

  if (cpuValues.length > 0) {
    metrics.push({
      name: "shipsquares_app_cpu_percent",
      type: "gauge",
      help: "App CPU usage percentage",
      values: cpuValues,
    });
  }

  if (memValues.length > 0) {
    metrics.push({
      name: "shipsquares_app_memory_used_bytes",
      type: "gauge",
      help: "App memory used in bytes",
      values: memValues,
    });
  }

  if (memLimitValues.length > 0) {
    metrics.push({
      name: "shipsquares_app_memory_limit_bytes",
      type: "gauge",
      help: "App memory limit in bytes",
      values: memLimitValues,
    });
  }

  // ── Host disk from metric_samples ─────────────────────────────────────────
  const [latestHostSample] = await db
    .select()
    .from(metricSamples)
    .where(and(eq(metricSamples.scope, "server"), isNull(metricSamples.serverId)))
    .orderBy(metricSamples.ts)
    .limit(1);

  if (latestHostSample?.diskBytes !== null && latestHostSample?.diskBytes !== undefined) {
    metrics.push({
      name: "shipsquares_host_disk_used_bytes",
      type: "gauge",
      help: "Host disk used in bytes",
      values: [{ labels: {}, value: latestHostSample.diskBytes }],
    });
  }

  return metrics;
}

/**
 * Format metrics in Prometheus exposition format.
 */
export function formatPrometheusOutput(metrics: PrometheusMetric[]): string {
  const lines: string[] = [];

  for (const metric of metrics) {
    lines.push(`# HELP ${metric.name} ${metric.help}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);

    for (const { labels, value } of metric.values) {
      const labelParts = Object.entries(labels)
        .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
        .join(",");

      if (labelParts) {
        lines.push(`${metric.name}{${labelParts}} ${formatValue(value)}`);
      } else {
        lines.push(`${metric.name} ${formatValue(value)}`);
      }
    }

    lines.push(""); // Blank line between metrics
  }

  return lines.join("\n");
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return "NaN";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(6);
}
