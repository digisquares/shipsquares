import { describe, expect, it } from "vitest";

import { assertTransition, canTransition } from "./model.js";

describe("server status transitions", () => {
  it("allows the bootstrap happy path and recovery", () => {
    expect(canTransition("adding", "bootstrapping")).toBe(true);
    expect(canTransition("bootstrapping", "ready")).toBe(true);
    expect(canTransition("ready", "unreachable")).toBe(true);
    expect(canTransition("unreachable", "ready")).toBe(true);
    expect(canTransition("error", "bootstrapping")).toBe(true);
  });

  it("rejects illegal jumps", () => {
    expect(canTransition("adding", "ready")).toBe(false);
    expect(canTransition("ready", "adding")).toBe(false);
    expect(() => assertTransition("adding", "ready")).toThrow(/invalid server status/);
  });
});
