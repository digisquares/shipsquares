import { describe, expect, it, vi } from "vitest";

import { dispatchDeploy } from "./dispatch.js";

describe("dispatchDeploy", () => {
  it("enqueues on the deploy queue with the deployment payload", async () => {
    const send = vi.fn(async () => "job_1");
    const fallback = vi.fn();
    await dispatchDeploy({ send }, "dpl_1", { image: "app:abc" }, fallback);
    expect(send).toHaveBeenCalledWith("deploy", { deploymentId: "dpl_1", image: "app:abc" });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("carries the preview context through the queue payload", async () => {
    const send = vi.fn(async () => "job_2");
    await dispatchDeploy(
      { send },
      "dpl_2",
      { preview: { prNumber: 7, branch: "feat/x" } },
      vi.fn(),
    );
    expect(send).toHaveBeenCalledWith("deploy", {
      deploymentId: "dpl_2",
      preview: { prNumber: 7, branch: "feat/x" },
    });
  });

  it("falls back to inline execution when the queue is unavailable", async () => {
    const send = vi.fn(async () => {
      throw new Error("boss not started");
    });
    const fallback = vi.fn();
    await dispatchDeploy({ send }, "dpl_1", {}, fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
