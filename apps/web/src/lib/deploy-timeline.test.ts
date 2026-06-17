import { describe, expect, it } from "vitest";

import { deployTimeline, stepDuration, stepsTimeline } from "./deploy-timeline";

const states = (status: string) => deployTimeline(status).map((p) => p.state);

describe("deployTimeline", () => {
  it("queued: first phase active, rest pending", () => {
    expect(states("queued")).toEqual(["active", "pending", "pending"]);
  });

  it("running: queued done, in-progress active", () => {
    expect(states("running")).toEqual(["done", "active", "pending"]);
  });

  it("succeeded: all done", () => {
    expect(states("succeeded")).toEqual(["done", "done", "done"]);
  });

  it("failed: in-progress phase fails, deployed never reached", () => {
    expect(states("failed")).toEqual(["done", "failed", "pending"]);
  });

  it("is case-insensitive", () => {
    expect(states("SUCCEEDED")).toEqual(["done", "done", "done"]);
  });

  it("unknown status: all pending", () => {
    expect(states("")).toEqual(["pending", "pending", "pending"]);
  });

  it("always returns the three lifecycle phases", () => {
    expect(deployTimeline("running").map((p) => p.id)).toEqual(["queued", "running", "done"]);
  });
});

describe("stepsTimeline", () => {
  const step = (name: string, status: string, started?: string, finished?: string) => ({
    name,
    status,
    startedAt: started ?? null,
    finishedAt: finished ?? null,
  });

  it("returns null when no steps are recorded (caller falls back to the lifecycle)", () => {
    expect(stepsTimeline([])).toBeNull();
  });

  it("maps recorded step statuses onto phase states with durations", () => {
    const phases = stepsTimeline([
      step("fetch", "succeeded", "2026-06-12T10:00:00Z", "2026-06-12T10:00:04Z"),
      step("build", "running", "2026-06-12T10:00:04Z"),
      step("health", "pending"),
    ])!;
    expect(phases.map((p) => p.state)).toEqual(["done", "active", "pending"]);
    expect(phases.map((p) => p.label)).toEqual(["fetch", "build", "health"]);
    expect(phases[0]?.duration).toBe("4s");
    expect(phases[1]?.duration).toBeUndefined();
  });

  it("shows a failed step as failed", () => {
    const phases = stepsTimeline([
      step("fetch", "succeeded", "2026-06-12T10:00:00Z", "2026-06-12T10:00:01Z"),
      step("build", "failed", "2026-06-12T10:00:01Z", "2026-06-12T10:01:13Z"),
    ])!;
    expect(phases[1]).toMatchObject({ state: "failed", duration: "1m 12s" });
  });
});

describe("stepDuration", () => {
  it("formats seconds and minutes, sub-second rounds up to 1s", () => {
    expect(stepDuration("2026-06-12T10:00:00Z", "2026-06-12T10:00:04.2Z")).toBe("4s");
    expect(stepDuration("2026-06-12T10:00:00Z", "2026-06-12T10:01:12Z")).toBe("1m 12s");
    expect(stepDuration("2026-06-12T10:00:00.0Z", "2026-06-12T10:00:00.3Z")).toBe("1s");
  });

  it("is null until both timestamps exist", () => {
    expect(stepDuration(null, null)).toBeNull();
    expect(stepDuration("2026-06-12T10:00:00Z", null)).toBeNull();
  });
});
