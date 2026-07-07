// Best-effort error sink (platform-review C4). Many secondary/background paths
// intentionally never throw — auditing must not break a mutation, a metrics tick
// must not crash the process, a notify failure must not fail a deploy. But they
// used to swallow *silently* (`catch { /* best-effort */ }`), so a persistent
// failure (audit inserts failing, every metrics tick erroring) was invisible.
// `swallow` keeps the non-throwing behaviour but always leaves a breadcrumb.
//
// The control plane runs with Fastify `logger: false` and emits operational
// output via `console.*` (see index.ts), so this does too. `op` is a short,
// greppable label like "audit.insert" or "metrics.tick".
export function swallow(op: string, err: unknown, level: "warn" | "error" = "warn"): void {
  const msg = err instanceof Error ? err.message : String(err);
  (level === "error" ? console.error : console.warn)(`[swallow] ${op}: ${msg}`);
}
