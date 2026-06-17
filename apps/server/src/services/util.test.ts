import { describe, expect, it } from "vitest";

import { isUniqueViolation } from "./util.js";

describe("isUniqueViolation", () => {
  it("matches a direct postgres 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("matches when the code is wrapped in a cause chain (drizzle wraps pg errors)", () => {
    expect(isUniqueViolation(new Error("insert failed", { cause: { code: "23505" } }))).toBe(true);
    expect(isUniqueViolation({ cause: { cause: { code: "23505" } } })).toBe(true);
  });

  it("is false for other codes, plain errors, and self-referential causes", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false); // FK violation, not unique
    expect(isUniqueViolation(new Error("nope"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    const cyclic: { code: string; cause?: unknown } = { code: "x" };
    cyclic.cause = cyclic;
    expect(isUniqueViolation(cyclic)).toBe(false);
  });
});
