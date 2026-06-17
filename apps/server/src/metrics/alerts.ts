// Threshold-alert evaluation (ROADMAP R1.3). Pure: the runtime feeds the
// window's sample values + the alert row; we answer fire/quiet/cooldown.
// Average-over-window (not max) so a single scrape spike doesn't page, and a
// one-window cooldown so a sustained breach pages once per window, not once
// per collection tick.

export type AlertDecision = "fire" | "quiet" | "cooldown";

export function evaluateAlert(input: {
  values: number[];
  thresholdPct: number;
  lastFiredAt: number | null;
  windowMs: number;
  now: number;
}): AlertDecision {
  if (input.values.length === 0) return "quiet";
  const avg = input.values.reduce((sum, v) => sum + v, 0) / input.values.length;
  if (avg < input.thresholdPct) return "quiet";
  if (input.lastFiredAt !== null && input.now - input.lastFiredAt <= input.windowMs) {
    return "cooldown";
  }
  return "fire";
}
