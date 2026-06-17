import { describe, expect, it } from "vitest";

import { SeqCounter } from "./seq-counter.js";

describe("SeqCounter", () => {
  it("increments monotonically and independently per deployment", () => {
    const counter = new SeqCounter();
    expect(counter.next("dpl_1")).toBe(1);
    expect(counter.next("dpl_1")).toBe(2);
    expect(counter.next("dpl_2")).toBe(1);
    expect(counter.current("dpl_1")).toBe(2);
  });

  it("resets after release", () => {
    const counter = new SeqCounter();
    counter.next("dpl_1");
    counter.next("dpl_1");
    counter.release("dpl_1");
    expect(counter.next("dpl_1")).toBe(1);
  });
});
