import { describe, expect, it } from "vitest";

import { boundedTail, firstErrorIndex, isErrorLine, matchLine, parseAnsi, stripAnsi } from "./logs";

const ESC = String.fromCharCode(27);

describe("stripAnsi / parseAnsi", () => {
  it("strips SGR escape codes", () => {
    expect(stripAnsi(`${ESC}[31mERR${ESC}[0m ok`)).toBe("ERR ok");
  });

  it("parses colored segments and drops the escapes", () => {
    const spans = parseAnsi(`${ESC}[31mERR${ESC}[0m ok`);
    expect(spans.map((s) => s.text).join("")).toBe("ERR ok");
    expect(spans[0]?.classes).toContain("ansi-red");
    expect(spans[1]?.classes ?? []).not.toContain("ansi-red");
  });

  it("returns one plain span when there are no codes", () => {
    const spans = parseAnsi("plain text");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.classes).toEqual([]);
  });

  it("handles bold (1) then reset (0)", () => {
    const spans = parseAnsi(`${ESC}[1mB${ESC}[0mn`);
    expect(spans[0]?.classes).toContain("ansi-bold");
    expect(spans[1]?.classes).toEqual([]);
  });
});

describe("isErrorLine / firstErrorIndex", () => {
  it("flags stderr and error-ish text", () => {
    expect(isErrorLine({ line: "all good" })).toBe(false);
    expect(isErrorLine({ line: "ok", stream: "stderr" })).toBe(true);
    expect(isErrorLine({ line: "FATAL: boom" })).toBe(true);
  });

  it("returns the first error line index", () => {
    const lines = [
      { line: "start" },
      { line: "building" },
      { line: "Error: nope" },
      { line: "Error: again" },
    ];
    expect(firstErrorIndex(lines)).toBe(2);
  });

  it("returns -1 when there is no error", () => {
    expect(firstErrorIndex([{ line: "a" }, { line: "b" }])).toBe(-1);
  });
});

describe("boundedTail", () => {
  it("keeps the last N lines", () => {
    expect(boundedTail([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });
  it("returns the array unchanged when within bounds", () => {
    expect(boundedTail([1, 2], 3)).toEqual([1, 2]);
  });
});

describe("matchLine", () => {
  it("is case-insensitive and ignores ansi codes", () => {
    expect(matchLine(`${ESC}[32mHELLO${ESC}[0m`, "hello")).toBe(true);
    expect(matchLine("nope", "xyz")).toBe(false);
  });
  it("an empty query matches everything", () => {
    expect(matchLine("anything", "  ")).toBe(true);
  });
});
