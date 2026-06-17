import { firstStdout, runCommand } from "./exec.js";

// Live container resource usage (32-monitoring-metrics.md): a point-in-time
// snapshot from `docker stats` for the app's running container. The web UI polls
// this and renders rolling sparklines (live perf charts); historical sampling
// into metric_samples is a later step.
export interface AppMetrics {
  running: boolean;
  cpuPercent?: number;
  memPercent?: number;
  memUsage?: string; // e.g. "12MiB / 128MiB"
}

export async function appMetrics(appId: string): Promise<AppMetrics> {
  const list = await runCommand("docker", [
    "ps",
    "-q",
    "--filter",
    `label=shipsquares.app=${appId}`,
  ]);
  const id = list.lines.find((l) => l.stream === "stdout")?.line.trim();
  if (!id) return { running: false };

  const out = firstStdout(
    await runCommand("docker", ["stats", "--no-stream", "--format", "{{json .}}", id]),
  );
  if (!out) return { running: false };
  try {
    const s = JSON.parse(out) as { CPUPerc?: string; MemPerc?: string; MemUsage?: string };
    return {
      running: true,
      cpuPercent: Number.parseFloat((s.CPUPerc ?? "0").replace("%", "")) || 0,
      memPercent: Number.parseFloat((s.MemPerc ?? "0").replace("%", "")) || 0,
      memUsage: s.MemUsage ?? "",
    };
  } catch {
    return { running: true };
  }
}
