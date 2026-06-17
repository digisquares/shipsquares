import { describe, expect, it } from "vitest";

import { isLiveStatus, statusLabel, statusTone } from "./status";

describe("statusTone", () => {
  it("maps terminal-success states to ok", () => {
    expect(statusTone("succeeded")).toBe("ok");
    expect(statusTone("active")).toBe("ok");
  });
  it("maps in-progress states to warn", () => {
    expect(statusTone("running")).toBe("warn");
    expect(statusTone("queued")).toBe("warn");
    expect(statusTone("issuing")).toBe("warn");
  });
  it("maps failure states to fail", () => {
    expect(statusTone("failed")).toBe("fail");
    expect(statusTone("error")).toBe("fail");
  });
  it("is case-insensitive and falls back to neutral", () => {
    expect(statusTone("SUCCEEDED")).toBe("ok");
    expect(statusTone("whatever")).toBe("neutral");
  });
});

describe("statusLabel", () => {
  it("capitalizes the status", () => {
    expect(statusLabel("running")).toBe("Running");
    expect(statusLabel("")).toBe("");
  });
});

describe("isLiveStatus", () => {
  it("is true only for in-progress (warn) statuses", () => {
    expect(isLiveStatus("running")).toBe(true);
    expect(isLiveStatus("succeeded")).toBe(false);
    expect(isLiveStatus("failed")).toBe(false);
  });
});
