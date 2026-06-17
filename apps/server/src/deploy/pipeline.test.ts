import { describe, expect, it } from "vitest";

import { runPipeline } from "./pipeline.js";
import type {
  DeployContext,
  DeploymentRecorder,
  DeploymentStatus,
  PipelineStep,
  StepName,
  StepResult,
} from "./types.js";

function makeCtx(signal: AbortSignal): DeployContext {
  return {
    deploymentId: "dpl_1",
    job: { appId: "app_1", orgId: "org_1", serverId: "srv_1", trigger: "manual" },
    signal,
    outputs: {},
    log: () => {},
  };
}

function fakeRecorder() {
  const marks: DeploymentStatus[] = [];
  const recordedSteps: StepResult[] = [];
  const recorder: DeploymentRecorder = {
    markDeployment: async (_id, status) => {
      marks.push(status);
    },
    recordStep: async (_id, result) => {
      recordedSteps.push(result);
    },
  };
  return { recorder, marks, recordedSteps };
}

function step(
  name: StepName,
  status: StepResult["status"] = "succeeded",
  calls?: StepName[],
  outputs?: Record<string, string>,
): PipelineStep {
  return {
    name,
    run: async () => {
      calls?.push(name);
      return {
        step: name,
        status,
        startedAt: new Date(),
        finishedAt: new Date(),
        ...(outputs ? { outputs } : {}),
      };
    },
  };
}

describe("runPipeline", () => {
  it("runs steps in order and marks running → succeeded", async () => {
    const calls: StepName[] = [];
    const order: StepName[] = ["fetch", "build", "up"];
    const { recorder, marks } = fakeRecorder();
    const status = await runPipeline(
      makeCtx(new AbortController().signal),
      order.map((n) => step(n, "succeeded", calls)),
      recorder,
    );
    expect(status).toBe("succeeded");
    expect(calls).toEqual(order);
    expect(marks[0]).toBe("running");
    expect(marks.at(-1)).toBe("succeeded");
  });

  it("halts before later steps when a step fails", async () => {
    const calls: StepName[] = [];
    const { recorder, marks } = fakeRecorder();
    const status = await runPipeline(
      makeCtx(new AbortController().signal),
      [
        step("fetch", "succeeded", calls),
        step("preUp", "failed", calls),
        step("up", "succeeded", calls),
      ],
      recorder,
    );
    expect(status).toBe("failed");
    expect(calls).toEqual(["fetch", "preUp"]); // up never runs
    expect(marks.at(-1)).toBe("failed");
  });

  it("merges step outputs into ctx.outputs for later steps", async () => {
    const ctx = makeCtx(new AbortController().signal);
    const seen: Record<string, string>[] = [];
    const steps: PipelineStep[] = [
      {
        name: "fetch",
        run: async () => ({
          step: "fetch",
          status: "succeeded",
          outputs: { commit: "abc" },
          startedAt: new Date(),
          finishedAt: new Date(),
        }),
      },
      {
        name: "build",
        run: async (c) => {
          seen.push({ ...c.outputs });
          return {
            step: "build",
            status: "succeeded",
            outputs: { imageRef: "img:abc" },
            startedAt: new Date(),
            finishedAt: new Date(),
          };
        },
      },
    ];
    const { recorder } = fakeRecorder();
    await runPipeline(ctx, steps, recorder);
    expect(seen[0]).toEqual({ commit: "abc" });
    expect(ctx.outputs).toEqual({ commit: "abc", imageRef: "img:abc" });
  });

  it("marks cancelled (not failed) when the signal is aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const calls: StepName[] = [];
    const { recorder, marks } = fakeRecorder();
    const status = await runPipeline(
      makeCtx(ac.signal),
      [step("fetch", "succeeded", calls)],
      recorder,
    );
    expect(status).toBe("cancelled");
    expect(calls).toEqual([]);
    expect(marks.at(-1)).toBe("cancelled");
  });

  it("captures a thrown step as a failed result", async () => {
    const { recorder, recordedSteps } = fakeRecorder();
    const status = await runPipeline(
      makeCtx(new AbortController().signal),
      [{ name: "build", run: async () => Promise.reject(new Error("boom")) }],
      recorder,
    );
    expect(status).toBe("failed");
    expect(recordedSteps[0]?.status).toBe("failed");
    expect(recordedSteps[0]?.error?.message).toBe("boom");
  });
});
