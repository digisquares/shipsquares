import { afterEach, describe, expect, it, vi } from "vitest";

import { swallow } from "./swallow.js";

afterEach(() => vi.restoreAllMocks());

describe("swallow", () => {
  it("logs a greppable breadcrumb at warn by default and never throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => swallow("metrics.tick", new Error("boom"))).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toBe("[swallow] metrics.tick: boom");
  });

  it("logs at error when asked (e.g. a dropped audit row)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    swallow("audit.insert:app.deploy", new Error("db down"), "error");
    expect(error).toHaveBeenCalledExactlyOnceWith("[swallow] audit.insert:app.deploy: db down");
  });

  it("stringifies a non-Error value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    swallow("x.y", "plain string");
    expect(warn.mock.calls[0]![0]).toBe("[swallow] x.y: plain string");
  });
});
