import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import type { Api } from "./api.js";

// The MCP tool catalog (13-mcp-server.md): the platform's operations exposed to
// AI agents. Input schemas are plain JSON Schema (no zod across the SDK boundary).
const APP_ID: Tool["inputSchema"] = {
  type: "object",
  properties: { appId: { type: "string", description: "App id, e.g. app_abc123" } },
  required: ["appId"],
  additionalProperties: false,
};

export const TOOLS: Tool[] = [
  {
    name: "list_apps",
    description: "List all apps in the organization.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_app",
    description: "Get one app's details (source, branch, port).",
    inputSchema: APP_ID,
  },
  {
    name: "deploy_app",
    description: "Trigger a new deployment for an app. Returns the deployment id.",
    inputSchema: APP_ID,
  },
  {
    name: "get_deployment",
    description: "Get a deployment's status by id.",
    inputSchema: {
      type: "object",
      properties: { deploymentId: { type: "string", description: "Deployment id, e.g. dpl_…" } },
      required: ["deploymentId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_deployments",
    description: "List recent deployments for an app.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App id" },
        limit: { type: "integer", description: "Max rows (default 10)", minimum: 1, maximum: 100 },
      },
      required: ["appId"],
      additionalProperties: false,
    },
  },
  {
    name: "app_metrics",
    description: "Live CPU/memory of an app's running container.",
    inputSchema: APP_ID,
  },
  {
    name: "app_logs",
    description: "Tail an app's runtime container logs (stdout/stderr).",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "App id" },
        tail: {
          type: "integer",
          description: "Lines to return (default 200)",
          minimum: 1,
          maximum: 2000,
        },
      },
      required: ["appId"],
      additionalProperties: false,
    },
  },
];

export const TOOL_NAMES: string[] = TOOLS.map((t) => t.name);

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v) throw new Error(`missing required argument: ${key}`);
  return v;
}
function num(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Dispatch an MCP tool call to the API and return text content. Throws on an
 *  unknown tool or a missing argument (the server wraps it as an error result). */
export async function callTool(
  api: Api,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "list_apps":
      return JSON.stringify(await api.listApps(), null, 2);
    case "get_app":
      return JSON.stringify(await api.getApp(str(args, "appId")), null, 2);
    case "deploy_app": {
      const { id } = await api.deploy(str(args, "appId"));
      return `Deployment queued: ${id}`;
    }
    case "get_deployment":
      return JSON.stringify(await api.getDeployment(str(args, "deploymentId")), null, 2);
    case "list_deployments":
      return JSON.stringify(
        await api.listDeployments(str(args, "appId"), num(args, "limit", 10)),
        null,
        2,
      );
    case "app_metrics":
      return JSON.stringify(await api.appMetrics(str(args, "appId")), null, 2);
    case "app_logs": {
      const lines = await api.appLogs(str(args, "appId"), num(args, "tail", 200));
      return lines.length ? lines.map((l) => l.line).join("\n") : "(no logs)";
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
