import { describe, expect, it } from "vitest";

import { clampLimit } from "./db-performance.service.js";

describe("db-performance clampLimit", () => {
  it("defaults to 50 for undefined / non-finite input", () => {
    expect(clampLimit(undefined)).toBe(50);
    expect(clampLimit(Number.NaN)).toBe(50);
    expect(clampLimit(Number.POSITIVE_INFINITY)).toBe(50);
  });

  it("clamps to the 1..200 range and truncates", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(25.9)).toBe(25);
    expect(clampLimit(200)).toBe(200);
    expect(clampLimit(5000)).toBe(200);
  });
});
