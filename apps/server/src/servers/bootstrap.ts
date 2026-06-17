// Idempotent agentless bootstrap orchestrator (09-multi-server.md). Each step is
// detect-then-act: probe (already done? skip), apply, verify. The orchestrator is
// transport-agnostic — real steps close over the SSH executor — so it is pure and
// testable with fakes. Halts on the first failure (a half-bootstrapped server is
// re-runnable from where it stopped).

export interface BootstrapStep {
  id: string; // 'docker' | 'compose' | 'caddy' | 'network'
  probe(): Promise<boolean>;
  apply(log: (line: string) => void): Promise<void>;
  verify(): Promise<boolean>;
}

export type StepOutcome = "skipped" | "applied" | "failed";

export interface StepResult {
  id: string;
  outcome: StepOutcome;
  error?: string;
}

export async function runBootstrap(
  steps: BootstrapStep[],
  log: (line: string) => void,
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const step of steps) {
    try {
      if (await step.probe()) {
        results.push({ id: step.id, outcome: "skipped" });
        continue;
      }
      await step.apply(log);
      if (!(await step.verify())) {
        results.push({ id: step.id, outcome: "failed", error: "verification failed" });
        return results;
      }
      results.push({ id: step.id, outcome: "applied" });
    } catch (err) {
      results.push({
        id: step.id,
        outcome: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
      return results;
    }
  }
  return results;
}

export function bootstrapSucceeded(results: StepResult[]): boolean {
  return results.every((r) => r.outcome !== "failed");
}
