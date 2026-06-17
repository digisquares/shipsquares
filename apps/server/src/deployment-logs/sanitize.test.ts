import { describe, expect, it } from "vitest";

import { clampLineBytes, prepareLine, sanitizeUtf8, stripAnsi } from "./sanitize.js";

describe("stripAnsi", () => {
  it("removes CSI color/cursor sequences", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m text")).toBe("red text");
    expect(stripAnsi("plain")).toBe("plain");
  });
});

describe("sanitizeUtf8", () => {
  it("replaces a lone surrogate with U+FFFD and leaves valid text intact", () => {
    expect(sanitizeUtf8("a\uD800b")).toBe("a�b");
    expect(sanitizeUtf8("valid ✓")).toBe("valid ✓");
  });
});

describe("clampLineBytes", () => {
  it("leaves short lines unchanged", () => {
    expect(clampLineBytes("short", 100)).toBe("short");
  });

  it("truncates long lines with an explicit marker", () => {
    const out = clampLineBytes("x".repeat(50), 10);
    expect(out.startsWith("xxxxxxxxxx")).toBe(true);
    expect(out).toContain("[clamped 40 bytes]");
  });
});

describe("prepareLine", () => {
  it("strips ANSI, sanitizes, clamps, and redacts in one pass", () => {
    const redact = (s: string) => s.split("s3cr3t").join("***");
    const out = prepareLine({ stream: 0, text: "\x1b[32mtoken=s3cr3t\x1b[0m" }, 7, {
      maxLineBytes: 1000,
      redact,
    });
    expect(out).toEqual({ stream: 0, seq: 7, line: "token=***" });
  });
});
