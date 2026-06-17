import { describe, expect, it } from "vitest";

import { abortDeploy, clearDeploy, isCancelRequested, registerDeploy } from "./cancel-registry.js";

describe("deploy cancel registry", () => {
  it("registers a controller and aborts it by id", () => {
    const ac = registerDeploy("dpl_a");
    expect(isCancelRequested("dpl_a")).toBe(false);
    expect(abortDeploy("dpl_a")).toBe(true);
    expect(ac.signal.aborted).toBe(true);
    expect(isCancelRequested("dpl_a")).toBe(true);
    clearDeploy("dpl_a");
  });

  it("abortDeploy is false for an unknown / cleared deployment", () => {
    expect(abortDeploy("dpl_missing")).toBe(false);
    registerDeploy("dpl_b");
    clearDeploy("dpl_b");
    expect(abortDeploy("dpl_b")).toBe(false);
    expect(isCancelRequested("dpl_b")).toBe(false);
  });

  it("clear removes the controller so a later run starts fresh", () => {
    registerDeploy("dpl_c");
    abortDeploy("dpl_c");
    clearDeploy("dpl_c");
    const ac2 = registerDeploy("dpl_c");
    expect(ac2.signal.aborted).toBe(false);
    clearDeploy("dpl_c");
  });
});
