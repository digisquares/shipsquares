/**
 * Server health probe (R4.3). Pure functions that parse probe outputs and
 * decide whether a server is healthy. Used by the health job to probe
 * docker/disk over SSH and update the server status FSM.
 */

export interface DockerProbeResult {
  ok: boolean;
  version?: string;
  error?: string;
}

export interface DiskProbeResult {
  ok: boolean;
  usedPct?: number;
  usedBytes?: number;
  totalBytes?: number;
  error?: string;
}

export interface HealthProbeResult {
  docker: DockerProbeResult;
  disk: DiskProbeResult;
  reachable: boolean;
}

/**
 * Parse `docker version --format '{{.Server.Version}}'` output.
 * Returns ok:true with version if docker is running.
 */
export function parseDockerVersion(output: string, exitCode: number): DockerProbeResult {
  if (exitCode !== 0) {
    return { ok: false, error: `docker version failed with exit code ${exitCode}` };
  }
  const version = output.trim();
  if (!version || version.includes("Cannot connect")) {
    return { ok: false, error: "docker daemon not running or not reachable" };
  }
  // Basic version format check (e.g., "24.0.7", "20.10.21")
  if (!/^\d+\.\d+/.test(version)) {
    return { ok: false, error: `unexpected docker version format: ${version}` };
  }
  return { ok: true, version };
}

/**
 * Parse `df -kP /` output to get disk usage.
 * Format: "Filesystem 1K-blocks Used Available Use% Mounted"
 */
export function parseDiskUsage(output: string, exitCode: number): DiskProbeResult {
  if (exitCode !== 0) {
    return { ok: false, error: `df failed with exit code ${exitCode}` };
  }
  const lines = output.trim().split("\n");
  // Skip header, parse data line
  const dataLine = lines[1];
  if (!dataLine) {
    return { ok: false, error: "no data line in df output" };
  }
  // Split by whitespace: [Filesystem, 1K-blocks, Used, Available, Use%, Mounted]
  const parts = dataLine.split(/\s+/);
  if (parts.length < 5) {
    return { ok: false, error: `unexpected df output format: ${dataLine}` };
  }
  const totalKb = parseInt(parts[1]!, 10);
  const usedKb = parseInt(parts[2]!, 10);
  const usePctStr = parts[4]!.replace("%", "");
  const usedPct = parseInt(usePctStr, 10);

  if (isNaN(totalKb) || isNaN(usedKb) || isNaN(usedPct)) {
    return { ok: false, error: "failed to parse df numbers" };
  }

  return {
    ok: true,
    usedPct,
    usedBytes: usedKb * 1024,
    totalBytes: totalKb * 1024,
  };
}

/**
 * Decide the new server status based on probe results and current status.
 * Returns the new status or null if no change needed.
 */
export function decideServerStatus(
  current: "adding" | "bootstrapping" | "ready" | "error" | "unreachable",
  probe: HealthProbeResult,
): "ready" | "unreachable" | "error" | null {
  // If not reachable (SSH failed), mark unreachable
  if (!probe.reachable) {
    // Only transition from ready to unreachable (don't override adding/bootstrapping/error)
    if (current === "ready") {
      return "unreachable";
    }
    return null;
  }

  // Reachable — check docker
  if (!probe.docker.ok) {
    // Docker broken on a previously-ready server → error
    if (current === "ready" || current === "unreachable") {
      return "error";
    }
    return null;
  }

  // Everything ok — transition unreachable back to ready
  if (current === "unreachable") {
    return "ready";
  }

  return null; // No status change
}

/**
 * Check if disk usage exceeds threshold (for alerting, not status change).
 */
export function isDiskCritical(disk: DiskProbeResult, thresholdPct: number): boolean {
  if (!disk.ok || disk.usedPct === undefined) return false;
  return disk.usedPct >= thresholdPct;
}
