// Pure parsers for the metrics collector (ROADMAP R1.1): docker stats JSON
// lines, docker mem-usage strings, `df -kP /` output, and loadavg→percent.
// All tolerant — a garbled line drops the sample, never the collector.

const UNIT: Record<string, number> = {
  B: 1,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
};

function toBytes(raw: string): number | null {
  const m = /^([\d.]+)\s*([A-Za-z]+)$/.exec(raw.trim());
  if (!m) return null;
  const mult = UNIT[m[2]!.toUpperCase()];
  if (!mult) return null;
  return Math.round(Number(m[1]) * mult);
}

export function parseMemUsage(raw: string): { used: number; limit: number } | null {
  const [usedRaw, limitRaw] = raw.split("/").map((s) => s?.trim() ?? "");
  if (!usedRaw || !limitRaw) return null;
  const used = toBytes(usedRaw);
  const limit = toBytes(limitRaw);
  if (used === null || limit === null) return null;
  return { used, limit };
}

export interface ContainerStats {
  id: string;
  cpuPct: number;
  memBytes: number | null;
  memLimitBytes: number | null;
}

export function parseDockerStatsLine(line: string): ContainerStats | null {
  try {
    const s = JSON.parse(line) as { ID?: string; CPUPerc?: string; MemUsage?: string };
    if (!s.ID) return null;
    const mem = s.MemUsage ? parseMemUsage(s.MemUsage) : null;
    return {
      id: s.ID,
      cpuPct: Number.parseFloat((s.CPUPerc ?? "0").replace("%", "")) || 0,
      memBytes: mem?.used ?? null,
      memLimitBytes: mem?.limit ?? null,
    };
  } catch {
    return null;
  }
}

/** `df -kP /` → used/total bytes of the root filesystem. */
export function parseDfRoot(output: string): { usedBytes: number; totalBytes: number } | null {
  const row = output
    .split("\n")
    .slice(1)
    .find((l) => l.trim().length > 0);
  if (!row) return null;
  const cols = row.trim().split(/\s+/);
  const total = Number(cols[1]);
  const used = Number(cols[2]);
  if (!Number.isFinite(total) || !Number.isFinite(used)) return null;
  return { usedBytes: used * 1024, totalBytes: total * 1024 };
}

/** 1-minute loadavg normalized by core count, clamped to 0–100. */
export function hostCpuPct(load1: number, cores: number): number {
  if (cores <= 0) return 0;
  return Math.min(100, Math.max(0, (load1 / cores) * 100));
}
