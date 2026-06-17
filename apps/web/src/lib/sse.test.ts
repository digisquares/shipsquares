import { describe, expect, it } from "vitest";

import { createSseParser } from "./sse";

describe("createSseParser", () => {
  it("parses complete event frames", () => {
    const p = createSseParser();
    expect(p.push('event: tool\ndata: {"tool":"list_apps"}\n\n')).toEqual([
      { event: "tool", data: { tool: "list_apps" } },
    ]);
  });

  it("reassembles frames split across chunks", () => {
    const p = createSseParser();
    expect(p.push("event: done\nda")).toEqual([]);
    expect(p.push('ta: {"text":"hi"}\n\nevent: x\n')).toEqual([
      { event: "done", data: { text: "hi" } },
    ]);
    expect(p.push("data: {}\n\n")).toEqual([{ event: "x", data: {} }]);
  });

  it("returns multiple events from one chunk and skips malformed data", () => {
    const p = createSseParser();
    const events = p.push(
      'event: a\ndata: {"n":1}\n\nevent: bad\ndata: not-json\n\nevent: b\ndata: {"n":2}\n\n',
    );
    expect(events).toEqual([
      { event: "a", data: { n: 1 } },
      { event: "b", data: { n: 2 } },
    ]);
  });
});
