import { describe, expect, it } from "vitest";

import { parsePortMapping } from "./ports.js";

describe("parsePortMapping", () => {
  it("extracts the host port from docker port output", () => {
    expect(parsePortMapping("0.0.0.0:49153")).toBe("49153");
    expect(parsePortMapping("127.0.0.1:32768")).toBe("32768");
  });

  it("handles the IPv6 wildcard form", () => {
    expect(parsePortMapping("[::]:49153")).toBe("49153");
  });

  it("uses the first line of a multi-line mapping", () => {
    expect(parsePortMapping("0.0.0.0:49153\n[::]:49153")).toBe("49153");
  });

  it("returns null for empty or non-mapping output", () => {
    expect(parsePortMapping("")).toBeNull();
    expect(parsePortMapping("   ")).toBeNull();
    expect(parsePortMapping("no port")).toBeNull();
  });
});
