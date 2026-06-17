import { describe, expect, it } from "vitest";

import { isValidContainerTarget, isValidShell, isValidTail } from "./validators.js";

describe("console input validators (anti-injection)", () => {
  it("container targets: docker name charset only", () => {
    expect(isValidContainerTarget("ss-app_1")).toBe(true);
    expect(isValidContainerTarget("a.b-c_d")).toBe(true);
    for (const bad of ["", "a b", "a;b", "a$(x)", "a|b", "a'b", "../etc", "a\nb"]) {
      expect(isValidContainerTarget(bad), bad).toBe(false);
    }
    expect(isValidContainerTarget("x".repeat(256))).toBe(false);
  });

  it("shells: strict allowlist", () => {
    for (const ok of ["sh", "bash", "/bin/sh", "/bin/bash"]) {
      expect(isValidShell(ok), ok).toBe(true);
    }
    for (const bad of ["zsh", "sh; rm -rf /", "", "bash -c x"]) {
      expect(isValidShell(bad), bad).toBe(false);
    }
  });

  it("tail: bounded positive integers only", () => {
    expect(isValidTail(100)).toBe(true);
    expect(isValidTail(1)).toBe(true);
    for (const bad of [0, -5, 1.5, 10_001, NaN]) {
      expect(isValidTail(bad), String(bad)).toBe(false);
    }
  });
});
