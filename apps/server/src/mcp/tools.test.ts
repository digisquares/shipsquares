import { describe, expect, it } from "vitest";

import { PERMISSIONS } from "../rbac/permissions.js";

import { MCP_TOOLS, buildRestCall, findTool, toolPermission } from "./tools.js";

describe("MCP tool catalog", () => {
  it("every tool maps to a real RBAC permission", () => {
    for (const tool of MCP_TOOLS) {
      expect(PERMISSIONS).toContain(tool.permission);
    }
  });

  it("maps tools to their required permission", () => {
    expect(toolPermission("deploy_app")).toBe("deployment:write");
    expect(toolPermission("get_status")).toBe("app:read");
    expect(toolPermission("tail_logs")).toBe("deployment:read");
    expect(toolPermission("set_env")).toBe("env:write");
  });

  it("findTool returns undefined for an unknown tool", () => {
    expect(findTool("rm_rf")).toBeUndefined();
  });

  it("tool names are unique", () => {
    expect(new Set(MCP_TOOLS.map((t) => t.name)).size).toBe(MCP_TOOLS.length);
  });

  it("every tool carries a JSON-Schema object input", () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("deploy_app targets the real deployments route", () => {
    expect(findTool("deploy_app")?.rest.path).toBe("/apps/:appId/deployments");
  });

  it("mail tools carry mail:* permissions", () => {
    expect(toolPermission("list_mail_instances")).toBe("mail:read");
    expect(toolPermission("add_mail_domain")).toBe("mail:write");
    expect(toolPermission("get_mail_dns")).toBe("mail:read");
    expect(toolPermission("create_mailbox")).toBe("mail:write");
  });
});

describe("buildRestCall", () => {
  it("substitutes path params and throws on a missing one", () => {
    const call = buildRestCall(findTool("get_status")!, { id: "app_1" });
    expect(call).toEqual({ method: "GET", url: "/apps/app_1" });
    expect(() => buildRestCall(findTool("get_status")!, {})).toThrow(/id/);
  });

  it("puts leftover args on the query string for GET", () => {
    const call = buildRestCall(findTool("list_deployments")!, { appId: "app_1", limit: 10 });
    expect(call.method).toBe("GET");
    expect(call.url).toBe("/apps/app_1/deployments?limit=10");
    expect(call.body).toBeUndefined();
  });

  it("puts leftover args in the body for mutations", () => {
    const call = buildRestCall(findTool("add_domain")!, {
      appId: "app_1",
      fqdn: "shop.example.com",
    });
    expect(call).toEqual({
      method: "POST",
      url: "/apps/app_1/domains",
      body: { fqdn: "shop.example.com" },
    });
  });

  it("a mutation with only path params sends an empty body", () => {
    const call = buildRestCall(findTool("deploy_app")!, { appId: "app_1" });
    expect(call).toEqual({ method: "POST", url: "/apps/app_1/deployments", body: {} });
  });

  it("add_mail_domain puts the instance id in the path and fqdn in the body", () => {
    const call = buildRestCall(findTool("add_mail_domain")!, { id: "mli_1", fqdn: "acme.com" });
    expect(call).toEqual({
      method: "POST",
      url: "/mail/instances/mli_1/domains",
      body: { fqdn: "acme.com" },
    });
  });

  it("url-encodes substituted and query values", () => {
    const call = buildRestCall(findTool("get_status")!, { id: "a/b c" });
    expect(call.url).toBe("/apps/a%2Fb%20c");
  });
});
