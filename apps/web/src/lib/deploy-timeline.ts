// Deploy timeline (25-design-system.md, flow 3 "deploy detail — the stepper
// animates"). Two sources: the REAL recorded pipeline steps from
// GET /deployments/:id/steps (stepsTimeline — per-step states + durations),
// with the coarse status-derived lifecycle (deployTimeline) as the fallback
// while steps haven't loaded / for legacy rows without them. Pure + tested.

export type PhaseState = "done" | "active" | "failed" | "pending";
export type PhaseId = "queued" | "running" | "done";

export interface TimelinePhase {
  id: string;
  label: string;
  state: PhaseState;
  duration?: string;
}

export interface ApiStep {
  name: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** "4s" / "1m 12s"; sub-second rounds up to 1s; null until both ends exist. */
export function stepDuration(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt || !finishedAt) return null;
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const secs = Math.max(1, Math.round(ms / 1000));
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/** The recorded pipeline steps as stepper phases; null when none exist yet. */
export function stepsTimeline(steps: ApiStep[]): TimelinePhase[] | null {
  if (steps.length === 0) return null;
  return steps.map((s) => {
    const status = s.status.toLowerCase();
    const state: PhaseState =
      status === "succeeded"
        ? "done"
        : status === "failed"
          ? "failed"
          : status === "running"
            ? "active"
            : "pending";
    const duration = stepDuration(s.startedAt, s.finishedAt);
    return { id: s.name, label: s.name, state, ...(duration ? { duration } : {}) };
  });
}

export function deployTimeline(status: string): TimelinePhase[] {
  const s = status.toLowerCase();
  const states: Record<PhaseId, PhaseState> =
    s === "succeeded"
      ? { queued: "done", running: "done", done: "done" }
      : s === "failed"
        ? { queued: "done", running: "failed", done: "pending" }
        : s === "running" || s === "building" || s === "deploying"
          ? { queued: "done", running: "active", done: "pending" }
          : s === "queued"
            ? { queued: "active", running: "pending", done: "pending" }
            : { queued: "pending", running: "pending", done: "pending" };
  return [
    { id: "queued", label: "Queued", state: states.queued },
    { id: "running", label: "In progress", state: states.running },
    { id: "done", label: "Deployed", state: states.done },
  ];
}
