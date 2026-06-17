import { describe, expect, it } from "vitest";

import { logBus } from "./bus.js";

const frame = (seq: number) => ({ seq, stream: "stdout", line: `l${seq}`, at: "" });

describe("logBus", () => {
  it("delivers published log frames to subscribers and stops after unsubscribe", () => {
    const got: number[] = [];
    const unsub = logBus.onLog("dpl_x", (f) => got.push(f.seq));
    logBus.publishLog("dpl_x", frame(1));
    logBus.publishLog("dpl_x", frame(2));
    unsub();
    logBus.publishLog("dpl_x", frame(3));
    expect(got).toEqual([1, 2]);
  });

  it("isolates topics by deployment id and delivers status separately", () => {
    const a: number[] = [];
    let status = "";
    logBus.onLog("dpl_a", (f) => a.push(f.seq));
    logBus.onStatus("dpl_a", (s) => {
      status = s;
    });
    logBus.publishLog("dpl_b", frame(1)); // different deployment — ignored
    logBus.publishLog("dpl_a", frame(5));
    logBus.publishStatus("dpl_a", "succeeded");
    expect(a).toEqual([5]);
    expect(status).toBe("succeeded");
  });
});
