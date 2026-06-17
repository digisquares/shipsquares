// Status-reconcile decision (ROADMAP R2.3): an app whose latest succeeded
// deployment expects a running container but has none is DRIFTED — page once
// per cooldown window, never for healthy or never-deployed apps. Pure; the
// sweep service binds docker truth + the outbound-webhook fan-out.

export function reconcileDecision(input: {
  expectedRunning: boolean;
  actuallyRunning: boolean;
  lastNotifiedAt: number | null;
  cooldownMs: number;
  now: number;
}): "notify" | "quiet" {
  if (!input.expectedRunning || input.actuallyRunning) return "quiet";
  if (input.lastNotifiedAt !== null && input.now - input.lastNotifiedAt <= input.cooldownMs) {
    return "quiet";
  }
  return "notify";
}
