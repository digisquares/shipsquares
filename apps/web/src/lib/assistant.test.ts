import { describe, expect, it } from "vitest";

import { actionSummary, routeContext, suggestedPrompts, toolSummary } from "./assistant";

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

describe("actionSummary", () => {
  it("is null when only reads ran (nothing to recap)", () => {
    expect(actionSummary([{ tool: "list_apps" }, { tool: "get_status" }])).toBeNull();
  });

  it("recaps successful writes with friendly labels", () => {
    const out = actionSummary([
      { tool: "create_app", input: { name: "web" } },
      { tool: "add_domain", input: { appId: "app_1", fqdn: "shop.example.com" } },
    ]);
    expect(out).toEqual([
      { label: "Created app web" },
      { label: "Added domain shop.example.com", href: "#/apps/app_1" },
    ]);
  });

  it("omits failed actions and links a deploy to its app", () => {
    const out = actionSummary([
      { tool: "deploy_app", input: { appId: "app_9" } },
      { tool: "delete_app", input: { id: "app_x" }, isError: true },
    ]);
    expect(out).toEqual([{ label: "Deployed the app", href: "#/apps/app_9" }]);
  });
});

describe("routeContext", () => {
  it("describes the app being viewed so 'this app' resolves", () => {
    expect(routeContext({ name: "app", appId: "app_42" })).toContain("app_42");
  });

  it("is null on the dashboard (no specific resource)", () => {
    expect(routeContext({ name: "dashboard" })).toBeNull();
  });
});

describe("suggestedPrompts", () => {
  it("offers app-specific starters on an app page", () => {
    expect(suggestedPrompts({ name: "app", appId: "a1" })).toContain("Show the logs for this app");
  });

  it("falls back to base prompts on the dashboard", () => {
    expect(suggestedPrompts({ name: "dashboard" })).toContain("How do I set up PITR?");
  });
});
