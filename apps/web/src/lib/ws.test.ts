import { describe, expect, it } from "vitest";

import { parseWsFrame } from "./ws";

describe("parseWsFrame", () => {
  it("parses a valid frame with a string type", () => {
    expect(parseWsFrame('{"type":"deployment","deployment":{"status":"succeeded"}}')).toEqual({
      type: "deployment",
      deployment: { status: "succeeded" },
    });
  });

  it("rejects a frame missing a string type", () => {
    expect(parseWsFrame('{"foo":1}')).toBeNull();
    expect(parseWsFrame('{"type":2}')).toBeNull();
  });

  it("rejects non-objects and null", () => {
    expect(parseWsFrame('"hi"')).toBeNull();
    expect(parseWsFrame("null")).toBeNull();
  });

  it("rejects invalid JSON", () => {
    expect(parseWsFrame("{not json")).toBeNull();
  });
});
