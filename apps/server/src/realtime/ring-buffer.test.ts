import { describe, expect, it } from "vitest";

import { LimitQueue } from "./ring-buffer.js";

describe("LimitQueue", () => {
  it("keeps only the last `max` items (drops oldest)", () => {
    const q = new LimitQueue<number>(3);
    for (let i = 1; i <= 5; i++) q.push(i);
    expect(q.toArray()).toEqual([3, 4, 5]);
    expect(q.size).toBe(3);
  });

  it("fires onExceed with each evicted (oldest) item", () => {
    const q = new LimitQueue<number>(2);
    const evicted: number[] = [];
    q.onExceed = (item) => evicted.push(item);
    for (let i = 1; i <= 4; i++) q.push(i);
    expect(evicted).toEqual([1, 2]);
    expect(q.toArray()).toEqual([3, 4]);
  });

  it("holds fewer than max until filled", () => {
    const q = new LimitQueue<string>(10);
    q.push("a");
    q.push("b");
    expect(q.toArray()).toEqual(["a", "b"]);
  });

  it("clears", () => {
    const q = new LimitQueue<number>(2);
    q.push(1);
    q.clear();
    expect(q.size).toBe(0);
  });

  it("rejects a max < 1", () => {
    expect(() => new LimitQueue(0)).toThrow();
  });
});
