import { describe, expect, it, vi } from "vitest";

import type { Api } from "./api.js";
import { callTool, TOOL_NAMES, TOOLS } from "./tools.js";

function fakeApi(over: Partial<Api> = {}): Api {
  return {
    listApps: vi.fn(),
    getApp: vi.fn(),
    deploy: vi.fn(),
    getDeployment: vi.fn(),
    listDeployments: vi.fn(),
    appMetrics: vi.fn(),
    appLogs: vi.fn(),
    ...over,
  } as Api;
}

describe("tool catalog", () => {
  it("every tool has a name, description, and an object input schema", () => {
    for (const t of TOOLS) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.inputSchema.type).toBe("object");
    }
    expect(TOOL_NAMES).toContain("list_apps");
    expect(TOOL_NAMES).toContain("deploy_app");
  });
});

describe("callTool", () => {
  it("list_apps returns the apps as JSON", async () => {
    const api = fakeApi({
      listApps: vi.fn().mockResolvedValue([{ id: "app_1", name: "api" }]),
    });
    const out = JSON.parse(await callTool(api, "list_apps", {}));
    expect(out[0].name).toBe("api");
  });

  it("deploy_app triggers a deploy and reports the id", async () => {
    const deploy = vi.fn().mockResolvedValue({ id: "dpl_9" });
    const out = await callTool(fakeApi({ deploy }), "deploy_app", { appId: "app_1" });
    expect(deploy).toHaveBeenCalledWith("app_1");
    expect(out).toContain("dpl_9");
  });

  it("app_logs joins lines, with a placeholder when empty", async () => {
    const lines = [
      { stream: "stdout", line: "hello" },
      { stream: "stderr", line: "oops" },
    ];
    expect(
      await callTool(fakeApi({ appLogs: vi.fn().mockResolvedValue(lines) }), "app_logs", {
        appId: "a",
      }),
    ).toBe("hello\noops");
    expect(
      await callTool(fakeApi({ appLogs: vi.fn().mockResolvedValue([]) }), "app_logs", {
        appId: "a",
      }),
    ).toBe("(no logs)");
  });

  it("throws on a missing required argument", async () => {
    await expect(callTool(fakeApi(), "get_app", {})).rejects.toThrow(/appId/);
  });

  it("throws on an unknown tool", async () => {
    await expect(callTool(fakeApi(), "bogus", {})).rejects.toThrow(/unknown tool/);
  });
});
