import { describe, expect, it } from "vitest";

import { bandPath, linePath, timeTicks } from "./chart";

const pts = [
  { ts: 0, avg: 0, min: 0, max: 0, count: 1 },
  { ts: 50, avg: 50, min: 40, max: 60, count: 1 },
  { ts: 100, avg: 100, min: 90, max: 100, count: 1 },
];

describe("linePath", () => {
  it("maps ts→x and value→inverted y across the box", () => {
    expect(linePath(pts, 100, 100, 100)).toBe("M0,100 L50,50 L100,0");
  });

  it("returns an empty path for fewer than two points", () => {
    expect(linePath([pts[0]!], 100, 100, 100)).toBe("");
    expect(linePath([], 100, 100, 100)).toBe("");
  });

  it("clamps values above yMax to the top edge", () => {
    const spiky = [
      { ts: 0, avg: 0, min: 0, max: 0, count: 1 },
      { ts: 100, avg: 250, min: 0, max: 250, count: 1 },
    ];
    expect(linePath(spiky, 100, 100, 100)).toBe("M0,100 L100,0");
  });
});

describe("bandPath", () => {
  it("draws max forward then min backward, closed", () => {
    expect(bandPath(pts, 100, 100, 100)).toBe("M0,100 L50,40 L100,0 L100,10 L50,60 L0,100 Z");
  });
});

describe("timeTicks", () => {
  it("returns evenly spaced tick positions with HH:MM labels", () => {
    const ticks = timeTicks(
      [
        { ts: Date.UTC(2026, 5, 13, 10, 0), avg: 0, min: 0, max: 0, count: 1 },
        { ts: Date.UTC(2026, 5, 13, 12, 0), avg: 0, min: 0, max: 0, count: 1 },
      ],
      200,
      3,
    );
    expect(ticks).toHaveLength(3);
    expect(ticks[0]).toMatchObject({ x: 0 });
    expect(ticks[2]).toMatchObject({ x: 200 });
    expect(ticks.every((t) => /^\d{2}:\d{2}$/.test(t.label))).toBe(true);
  });

  it("is empty without a time span", () => {
    expect(timeTicks([], 200, 3)).toEqual([]);
  });
});
