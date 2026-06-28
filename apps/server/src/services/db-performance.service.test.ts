import { AppError } from "@ss/shared";
import { describe, expect, it } from "vitest";

import { asPgssError, clampLimit } from "./db-performance.service.js";

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

describe("db-performance asPgssError", () => {
  it("maps a not-preloaded view-query error to an actionable 503", () => {
    // When the module isn't preloaded, CREATE EXTENSION succeeds but the view
    // query raises this — it must still become the 503 remediation, not a 500.
    const err = new Error(
      'ERROR: pg_stat_statements must be loaded via "shared_preload_libraries"',
    );
    try {
      asPgssError(err);
      expect.unreachable("asPgssError must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).status).toBe(503);
      expect((e as AppError).code).toBe("db_performance.extension_unavailable");
    }
  });

  it("passes an already-mapped AppError through unchanged", () => {
    const original = new AppError("nope", { status: 503, code: "db_performance.no_data" });
    try {
      asPgssError(original);
      expect.unreachable("asPgssError must throw");
    } catch (e) {
      expect(e).toBe(original);
    }
  });

  it("rethrows unrelated errors for the global handler to sanitize", () => {
    const other = new Error("connection refused");
    expect(() => asPgssError(other)).toThrow("connection refused");
  });
});
