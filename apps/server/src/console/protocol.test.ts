import { describe, expect, it } from "vitest";

import { parseConsoleFrame } from "./protocol.js";

describe("parseConsoleFrame", () => {
  it("accepts a valid open frame (validated target + allowlisted shell)", () => {
    expect(
      parseConsoleFrame(JSON.stringify({ type: "open", target: "ss-app_1", shell: "sh" })),
    ).toEqual({ type: "open", target: "ss-app_1", shell: "sh" });
  });

  it("rejects open frames with injection-shaped targets or unknown shells", () => {
    expect(
      parseConsoleFrame(JSON.stringify({ type: "open", target: "a;rm -rf /", shell: "sh" })),
    ).toBeNull();
    expect(
      parseConsoleFrame(JSON.stringify({ type: "open", target: "ok", shell: "zsh" })),
    ).toBeNull();
  });

  it("accepts input frames and caps the payload size", () => {
    expect(parseConsoleFrame(JSON.stringify({ type: "input", data: "ls\n" }))).toEqual({
      type: "input",
      data: "ls\n",
    });
    expect(
      parseConsoleFrame(JSON.stringify({ type: "input", data: "x".repeat(64 * 1024 + 1) })),
    ).toBeNull();
  });

  it("accepts resize frames with bounded integer dimensions", () => {
    expect(parseConsoleFrame(JSON.stringify({ type: "resize", cols: 120, rows: 40 }))).toEqual({
      type: "resize",
      cols: 120,
      rows: 40,
    });
    expect(parseConsoleFrame(JSON.stringify({ type: "resize", cols: 0, rows: 40 }))).toBeNull();
    expect(parseConsoleFrame(JSON.stringify({ type: "resize", cols: 1.5, rows: 40 }))).toBeNull();
    expect(parseConsoleFrame(JSON.stringify({ type: "resize", cols: 9999, rows: 40 }))).toBeNull();
  });

  it("rejects non-JSON and unknown types", () => {
    expect(parseConsoleFrame("not json")).toBeNull();
    expect(parseConsoleFrame(JSON.stringify({ type: "exec", cmd: "rm" }))).toBeNull();
  });
});
