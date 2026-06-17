import { describe, expect, it } from "vitest";

import { type BootstrapStep, bootstrapSucceeded, runBootstrap } from "./bootstrap.js";

function step(
  id: string,
  opts: { probe?: boolean; verify?: boolean; throwOnApply?: boolean } = {},
): BootstrapStep {
  return {
    id,
    probe: async () => opts.probe ?? false,
    apply: async () => {
      if (opts.throwOnApply) throw new Error("apply failed");
    },
    verify: async () => opts.verify ?? true,
  };
}

const noLog = () => {};

describe("runBootstrap", () => {
  it("skips steps whose probe is already satisfied", async () => {
    const results = await runBootstrap(
      [step("docker", { probe: true }), step("caddy", { probe: true })],
      noLog,
    );
    expect(results.map((r) => r.outcome)).toEqual(["skipped", "skipped"]);
    expect(bootstrapSucceeded(results)).toBe(true);
  });

  it("applies + verifies steps in order", async () => {
    const order: string[] = [];
    const mk = (id: string): BootstrapStep => ({
      id,
      probe: async () => false,
      apply: async () => {
        order.push(id);
      },
      verify: async () => true,
    });
    const results = await runBootstrap([mk("docker"), mk("network")], noLog);
    expect(order).toEqual(["docker", "network"]);
    expect(results.map((r) => r.outcome)).toEqual(["applied", "applied"]);
  });

  it("halts on a verify failure (later steps not reached)", async () => {
    const results = await runBootstrap(
      [step("docker"), step("caddy", { verify: false }), step("network")],
      noLog,
    );
    expect(results.map((r) => r.id)).toEqual(["docker", "caddy"]);
    expect(results.at(-1)?.outcome).toBe("failed");
    expect(bootstrapSucceeded(results)).toBe(false);
  });

  it("halts and records the error when apply throws", async () => {
    const results = await runBootstrap(
      [step("docker", { throwOnApply: true }), step("caddy")],
      noLog,
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "docker", outcome: "failed", error: "apply failed" });
  });
});
