// Reconcile container truth from `docker compose ps --format json` (Dockge
// stack.ts getStatusList pattern). Compose v2 emits either a JSON array or
// NDJSON depending on minor version, so parse both shapes defensively.

export type ServiceState = "running" | "exited" | "created" | "unknown";

interface ComposePsEntry {
  Service?: string;
  Name?: string;
  State?: string;
}

function normalizeState(state: string | undefined): ServiceState {
  const s = (state ?? "").toLowerCase();
  if (s.includes("running") || s === "up") return "running";
  if (s.includes("exited") || s.includes("dead")) return "exited";
  if (s.includes("created")) return "created";
  return "unknown";
}

export function parseComposeStatus(raw: string): Record<string, ServiceState> {
  const text = raw.trim();
  if (!text) return {};

  const entries: ComposePsEntry[] = text.startsWith("[")
    ? (JSON.parse(text) as ComposePsEntry[])
    : text
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as ComposePsEntry);

  const out: Record<string, ServiceState> = {};
  for (const entry of entries) {
    const name = entry.Service ?? entry.Name;
    if (name) out[name] = normalizeState(entry.State);
  }
  return out;
}
