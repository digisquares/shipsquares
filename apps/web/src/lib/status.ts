// Status → tone/label model for the StatusPill (25-design-system.md: "status
// pills … with subtle motion on transition"). Pure + unit-tested. Note "running"
// defaults to in-progress (warn) — a healthy container passes tone="ok".

export type Tone = "ok" | "warn" | "fail" | "info" | "neutral";

const TONES: Record<string, Tone> = {
  succeeded: "ok",
  success: "ok",
  active: "ok",
  issued: "ok",
  ready: "ok",
  healthy: "ok",
  online: "ok",
  running: "warn",
  queued: "warn",
  building: "warn",
  deploying: "warn",
  pending: "warn",
  issuing: "warn",
  provisioning: "warn",
  // Managed email (R9): domain/DNS verification + instance health.
  verified: "ok",
  verifying: "warn",
  degraded: "warn",
  unreachable: "fail",
  failed: "fail",
  error: "fail",
  errored: "fail",
  crashed: "fail",
  offline: "fail",
  stopped: "neutral",
  unknown: "neutral",
  none: "neutral",
};

export function statusTone(status: string): Tone {
  return TONES[status.toLowerCase()] ?? "neutral";
}

export function statusLabel(status: string): string {
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : "";
}

// In-progress statuses get a subtle pulse.
export function isLiveStatus(status: string): boolean {
  return statusTone(status) === "warn";
}
