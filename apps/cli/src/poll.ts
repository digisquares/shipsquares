import { HttpError } from "./api.js";

// `ss deploy --wait` polling (33-cli.md). Resilient: a transient blip (5xx,
// network) must not fail CI while the deployment is still running — only a
// terminal status, an auth/identity error (401/404), a run of consecutive
// failures, or the time budget ends the wait. Sleep is injected for tests.

export interface PollResult {
  outcome: "succeeded" | "failed" | "cancelled" | "timeout" | "error";
  error?: string;
}

export interface PollOptions {
  getStatus: () => Promise<{ status: string }>;
  sleep: (ms: number) => Promise<void>;
  intervalMs?: number;
  timeoutMs?: number;
  maxConsecutiveFailures?: number;
}

const ABORT_STATUSES = new Set([401, 404]);

export async function pollDeployment(opts: PollOptions): Promise<PollResult> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const maxFailures = opts.maxConsecutiveFailures ?? 5;
  const attempts = Math.max(1, Math.floor(timeoutMs / intervalMs));

  let consecutiveFailures = 0;
  let lastError = "";
  for (let i = 0; i < attempts; i += 1) {
    try {
      const d = await opts.getStatus();
      consecutiveFailures = 0;
      if (d.status === "succeeded") return { outcome: "succeeded" };
      if (d.status === "failed" || d.status === "cancelled") {
        return { outcome: d.status, error: `deployment ${d.status}` };
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (e instanceof HttpError && ABORT_STATUSES.has(e.status)) {
        return { outcome: "error", error: lastError };
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= maxFailures) {
        return {
          outcome: "error",
          error: `gave up after ${maxFailures} failed polls: ${lastError}`,
        };
      }
    }
    await opts.sleep(intervalMs);
  }
  return { outcome: "timeout" };
}
