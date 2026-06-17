import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogWriter, createRedactor, type LogRow } from "./log-writer.js";

const AT = new Date("2026-06-10T12:00:00Z");

function makeWriter(over: Partial<Parameters<typeof createLogWriter>[0]> = {}) {
  const inserted: LogRow[][] = [];
  const published: LogRow[] = [];
  const writer = createLogWriter({
    deploymentId: "dpl_1",
    insert: async (rows) => {
      inserted.push(rows);
    },
    publish: (row) => published.push(row),
    batchSize: 2,
    flushMs: 1000,
    now: () => AT,
    ...over,
  });
  return { writer, inserted, published };
}

describe("createLogWriter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sanitizes at ingest: ANSI stripped, long lines clamped, secrets redacted", async () => {
    const redactor = createRedactor();
    redactor.add("gho_secret123");
    const { writer, inserted } = makeWriter({ redact: redactor.redact, maxLineBytes: 32 });
    writer.write("stp_1", "stdout", "[31mcloning https://x:gho_secret123@github.com[0m");
    await writer.close();
    const line = inserted[0]![0]!.line;
    expect(line).not.toContain("");
    expect(line).not.toContain("gho_secret123");
    expect(line).toContain("[redacted]");
  });

  it("publishes immediately, batches inserts, keeps one monotonic seq across steps", async () => {
    const { writer, inserted, published } = makeWriter();
    writer.write("stp_a", "stdout", "one");
    expect(published).toHaveLength(1); // realtime is not batched
    writer.write("stp_b", "stderr", "two"); // hits batchSize=2 → flush
    writer.write("stp_b", "system", "three");
    await writer.close();
    expect(published.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(inserted.flat().map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(inserted[0]).toHaveLength(2);
    expect(writer.count()).toBe(3);
  });

  it("flushes on the timer when below batch size", async () => {
    const { writer, inserted } = makeWriter({ flushMs: 500 });
    writer.write("stp_1", "stdout", "lonely");
    expect(inserted).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(inserted.flat()).toHaveLength(1);
    await writer.close();
  });

  it("never throws when inserts fail; reports once per failed flush and keeps going", async () => {
    const onError = vi.fn();
    let calls = 0;
    const inserted: LogRow[][] = [];
    const writer = createLogWriter({
      deploymentId: "dpl_1",
      insert: async (rows) => {
        calls += 1;
        if (calls === 1) throw new Error("db down");
        inserted.push(rows);
      },
      publish: () => undefined,
      onError,
      batchSize: 1,
      now: () => AT,
    });
    writer.write("stp_1", "stdout", "first"); // fails
    writer.write("stp_1", "stdout", "second"); // succeeds
    await writer.close();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(inserted.flat().map((r) => r.line)).toEqual(["second"]);
  });
});

describe("createRedactor", () => {
  it("redacts every registered secret; ignores empty/short values", () => {
    const r = createRedactor();
    r.add("supersecret");
    r.add(""); // ignored
    r.add("ab"); // too short — would shred normal text
    expect(r.redact("token=supersecret rest")).toBe("token=[redacted] rest");
    expect(r.redact("plain ab text")).toBe("plain ab text");
  });
});
