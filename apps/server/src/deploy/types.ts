// Deploy-engine contracts (06-deploy-engine.md). The pipeline runner depends on
// these; the Docker-executing steps, pg-boss queue, and Postgres recorder
// implement them in the Docker/DB phase.

export type DeployTrigger = "webhook" | "manual" | "mcp" | "api" | "schedule" | "rollback";

export type StepName = "fetch" | "build" | "preUp" | "up" | "health" | "postUp" | "prune";

export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export type DeploymentStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface StepError {
  message: string;
  code?: string;
  exitCode?: number;
}

export interface StepResult {
  step: StepName;
  status: StepStatus;
  /** carried forward to later steps (e.g. { imageRef, commit, workDir }) */
  outputs?: Record<string, string>;
  error?: StepError;
  startedAt: Date;
  finishedAt: Date;
}

export interface DeployJob {
  appId: string;
  orgId: string;
  serverId: string;
  trigger: DeployTrigger;
  /** target commit (null => provider HEAD resolved during fetch) */
  commit?: string | null;
  /** rollback / image-only: skip the build step */
  skipBuild?: boolean;
  /** image-only deploy: use this ref directly, no fetch/build */
  imageRef?: string | null;
  /** dedupe key: provider delivery id, sha, or mcp request id */
  idempotencyKey?: string;
  /** rollback target deployment, when trigger === "rollback" */
  rollbackToDeploymentId?: string;
  actor?: { type: "user" | "apiKey" | "mcp" | "system"; id: string };
}

// The minimal context the pipeline runner needs. Docker-executing steps extend
// this with { app, docker, env, workDir } resolved at build time (06).
export interface DeployContext {
  readonly deploymentId: string;
  readonly job: DeployJob;
  readonly signal: AbortSignal;
  outputs: Record<string, string>;
  log(line: string, stream?: "stdout" | "stderr"): void;
}

export type Step = (ctx: DeployContext) => Promise<StepResult>;

export interface PipelineStep {
  name: StepName;
  run: Step;
}

// Event-sourced persistence boundary: deployment aggregate + step events. The
// Postgres impl writes deployments/deployment_steps rows + emits to the WS bus (12).
export interface DeploymentRecorder {
  markDeployment(deploymentId: string, status: DeploymentStatus, error?: StepError): Promise<void>;
  recordStep(deploymentId: string, result: StepResult): Promise<void>;
}
