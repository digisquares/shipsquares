import { describe, expect, it } from "vitest";

import { bucketSamples } from "./bucket.js";

describe("bucketSamples", () => {
  it("groups samples into fixed buckets with avg/min/max/count", () => {
    const buckets = bucketSamples(
      [
        { ts: 0, value: 10 },
        { ts: 50, value: 20 },
        { ts: 100, value: 30 },
        { ts: 150, value: 50 },
      ],
      100,
    );
    expect(buckets).toEqual([
      { ts: 0, avg: 15, min: 10, max: 20, count: 2 },
      { ts: 100, avg: 40, min: 30, max: 50, count: 2 },
    ]);
  });

  it("returns buckets oldest-first regardless of input order", () => {
    const buckets = bucketSamples(
      [
        { ts: 250, value: 1 },
        { ts: 50, value: 2 },
      ],
      100,
    );
    expect(buckets.map((b) => b.ts)).toEqual([0, 200]);
  });

  it("rejects a non-positive step", () => {
    expect(() => bucketSamples([], 0)).toThrow();
  });
});
