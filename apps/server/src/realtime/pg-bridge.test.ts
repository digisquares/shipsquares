import { describe, expect, it } from "vitest";

import { decodeBusEvent, encodeBusEvent } from "./pg-bridge.js";

const log = {
  kind: "log" as const,
  deploymentId: "dpl_1",
  frame: { seq: 7, stream: "stdout", line: "hello", at: "2026-06-13T10:00:00.000Z" },
};

describe("pg-bridge codec", () => {
  it("round-trips a log event and filters its own origin on decode", () => {
    const wire = encodeBusEvent(log, "proc-a");
    expect(decodeBusEvent(wire, "proc-b")).toEqual(log);
    expect(decodeBusEvent(wire, "proc-a")).toBeNull();
  });

  it("round-trips a status event", () => {
    const ev = { kind: "status" as const, deploymentId: "dpl_2", status: "succeeded" };
    expect(decodeBusEvent(encodeBusEvent(ev, "a"), "b")).toEqual(ev);
  });

  it("truncates oversized log lines to fit NOTIFY's payload budget", () => {
    const big = { ...log, frame: { ...log.frame, line: "x".repeat(20_000) } };
    const wire = encodeBusEvent(big, "a");
    expect(wire.length).toBeLessThanOrEqual(7800);
    const decoded = decodeBusEvent(wire, "b");
    expect(decoded?.kind).toBe("log");
    if (decoded?.kind === "log") {
      expect(decoded.frame.line.endsWith("…")).toBe(true);
    }
  });

  it("rejects malformed payloads instead of throwing", () => {
    expect(decodeBusEvent("not json", "a")).toBeNull();
    expect(decodeBusEvent('{"origin":"b"}', "a")).toBeNull();
  });
});
