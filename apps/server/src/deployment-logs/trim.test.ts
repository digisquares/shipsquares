import { describe, expect, it } from "vitest";

import { computeTrim } from "./trim.js";

describe("computeTrim", () => {
  it("does not trim when the row count is within the cap", () => {
    expect(computeTrim(3000, 3000, 5000)).toEqual({ deleteBelowSeq: null, truncated: false });
  });

  it("keeps the newest lineCap rows when over the cap", () => {
    // 6000 rows, cap 5000 → keep seq 1001..6000, delete seq < 1001
    expect(computeTrim(6000, 6000, 5000)).toEqual({ deleteBelowSeq: 1001, truncated: true });
  });

  it("treats lineCap <= 0 as no trim", () => {
    expect(computeTrim(100, 100, 0)).toEqual({ deleteBelowSeq: null, truncated: false });
  });
});
