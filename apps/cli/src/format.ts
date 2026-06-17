import type { App, Deployment, Metrics, RuntimeLogLine } from "./types.js";

// Pure presenters: typed data → a human string. Unit-tested. The CLI's `--json`
// path bypasses these and prints raw JSON instead.

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const fmt = (cells: string[]): string =>
    cells.map((c, i) => (c ?? "").padEnd(widths[i] ?? 0)).join("  ");
  return [fmt(headers), ...rows.map(fmt)].join("\n").trimEnd();
}

export function formatApps(apps: App[]): string {
  if (apps.length === 0) return "No apps.";
  return table(
    ["ID", "NAME", "SOURCE", "BRANCH"],
    apps.map((a) => [a.id, a.name, a.repo ?? a.image ?? "—", a.branch]),
  );
}

export function formatDeployments(deps: Deployment[]): string {
  if (deps.length === 0) return "No deployments.";
  return table(
    ["ID", "STATUS", "TRIGGER", "COMMIT", "QUEUED"],
    deps.map((d) => [d.id, d.status, d.trigger, d.commitAfter?.slice(0, 7) ?? "—", d.queuedAt]),
  );
}

export function formatMetrics(m: Metrics): string {
  if (!m.running) return "stopped (no running container)";
  const cpu = `${(m.cpuPercent ?? 0).toFixed(1)}%`;
  const mem = `${(m.memPercent ?? 0).toFixed(1)}%${m.memUsage ? ` (${m.memUsage})` : ""}`;
  return `running   cpu ${cpu}   mem ${mem}`;
}

export function formatLogs(lines: RuntimeLogLine[]): string {
  if (lines.length === 0) return "No logs.";
  return lines.map((l) => l.line).join("\n");
}
