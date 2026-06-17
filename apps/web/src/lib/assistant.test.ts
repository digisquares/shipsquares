import { describe, expect, it } from "vitest";

import { toolSummary } from "./assistant";

describe("toolSummary", () => {
  it("returns null for no tool activity", () => {
    expect(toolSummary([])).toBeNull();
  });

  it("dedupes repeated tools with a count", () => {
    expect(
      toolSummary([{ tool: "list_apps" }, { tool: "list_apps" }, { tool: "deploy_app" }]),
    ).toBe("ran list_apps ×2 · deploy_app");
  });

  it("flags a failed tool call", () => {
    expect(toolSummary([{ tool: "deploy_app", isError: true }])).toBe("ran deploy_app ⚠");
  });

  it("keeps first-use order", () => {
    expect(
      toolSummary([{ tool: "get_status" }, { tool: "tail_logs" }, { tool: "get_status" }]),
    ).toBe("ran get_status ×2 · tail_logs");
  });
});
