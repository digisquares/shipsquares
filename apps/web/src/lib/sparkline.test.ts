import { describe, expect, it } from "vitest";

import { sparklinePoints } from "./sparkline";

describe("sparklinePoints", () => {
  it("returns empty geometry for fewer than 2 points", () => {
    expect(sparklinePoints([])).toEqual({ line: "", area: "", last: null });
    expect(sparklinePoints([50])).toEqual({ line: "", area: "", last: null });
  });

  it("maps values to coordinates (0 at bottom, max at top)", () => {
    const g = sparklinePoints([0, 100], { width: 100, height: 10, min: 0, max: 100 });
    expect(g.line).toBe("0,10 100,0");
    expect(g.last).toEqual({ x: 100, y: 0 });
  });

  it("closes the area path back to the baseline", () => {
    const g = sparklinePoints([0, 100], { width: 100, height: 10 });
    expect(g.area).toBe("M 0,10 L 100,0 L 100,10 L 0,10 Z");
  });

  it("clamps out-of-range values to [min, max]", () => {
    const g = sparklinePoints([-20, 150], { width: 10, height: 10, min: 0, max: 100 });
    // -20 → clamps to 0 (bottom, y=10); 150 → clamps to 100 (top, y=0)
    expect(g.line).toBe("0,10 10,0");
  });

  it("spans the full width across N points", () => {
    const g = sparklinePoints([1, 2, 3], { width: 20, height: 10 });
    const xs = g.line.split(" ");
    expect(xs).toHaveLength(3);
    expect(xs[0]).toMatch(/^0,/);
    expect(xs.at(-1)).toMatch(/^20,/);
  });
});
