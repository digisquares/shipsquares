import type {
  DeployContext,
  DeploymentRecorder,
  DeploymentStatus,
  PipelineStep,
  StepError,
  StepName,
  StepResult,
} from "./types.js";

// The fixed pipeline order (06-deploy-engine.md). The concrete `run` functions
// are assembled in the Docker phase; the runner is order-agnostic + testable.
export const PIPELINE_ORDER: StepName[] = [
  "fetch",
  "build",
  "preUp",
  "up",
  "health",
  "postUp",
  "prune",
];

function toStepError(err: unknown): StepError {
  return err instanceof Error ? { message: err.message } : { message: String(err) };
}

async function runStep(ctx: DeployContext, step: PipelineStep): Promise<StepResult> {
  const startedAt = new Date();
  try {
    return await step.run(ctx);
  } catch (err) {
    return {
      step: step.name,
      status: "failed",
      error: toStepError(err),
      startedAt,
      finishedAt: new Date(),
    };
  }
}

/**
 * Run the ordered steps, persisting each transition through the recorder so the
 * deployment record is a replayable event log. A failed step halts the pipeline
 * before any later step; an aborted signal stops at the next step boundary and
 * marks the deployment `cancelled` (not `failed`). Step outputs are merged into
 * `ctx.outputs` so later steps see earlier results.
 */
export async function runPipeline(
  ctx: DeployContext,
  steps: PipelineStep[],
  recorder: DeploymentRecorder,
): Promise<DeploymentStatus> {
  await recorder.markDeployment(ctx.deploymentId, "running");

  for (const step of steps) {
    if (ctx.signal.aborted) {
      await recorder.markDeployment(ctx.deploymentId, "cancelled");
      return "cancelled";
    }

    const result = await runStep(ctx, step);
    await recorder.recordStep(ctx.deploymentId, result);

    if (result.status === "failed") {
      await recorder.markDeployment(ctx.deploymentId, "failed", result.error);
      return "failed";
    }
    if (result.outputs) Object.assign(ctx.outputs, result.outputs);
  }

  await recorder.markDeployment(ctx.deploymentId, "succeeded");
  return "succeeded";
}
