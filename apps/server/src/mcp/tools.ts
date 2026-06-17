import type { Permission } from "../rbac/permissions.js";

// The MCP tool catalog (13-mcp-server.md). Each tool is a thin wrapper over the
// REST API (04) carrying the SAME required permission (05) — one authorization
// story for web, mobile, and agents. Inputs are plain JSON Schema (the SDK's
// zod stays off our boundary); buildRestCall turns (tool, args) into the API
// request the streamable-HTTP route replays via app.inject.

export interface McpTool {
  name: string;
  description: string;
  permission: Permission;
  rest: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string };
  inputSchema: Record<string, unknown>;
}

const obj = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

export const MCP_TOOLS: McpTool[] = [
  {
    name: "list_apps",
    description: "List apps in the org",
    permission: "app:read",
    rest: { method: "GET", path: "/apps" },
    inputSchema: obj({ limit: { type: "integer", minimum: 1, maximum: 100 } }),
  },
  {
    name: "get_status",
    description: "Get an app's status",
    permission: "app:read",
    rest: { method: "GET", path: "/apps/:id" },
    inputSchema: obj({ id: { type: "string", description: "app id" } }, ["id"]),
  },
  {
    name: "deploy_app",
    description: "Trigger a deployment for an app",
    permission: "deployment:write",
    rest: { method: "POST", path: "/apps/:appId/deployments" },
    inputSchema: obj({ appId: { type: "string" } }, ["appId"]),
  },
  {
    name: "rollback",
    description: "Roll back to a previous succeeded deployment",
    permission: "deployment:write",
    rest: { method: "POST", path: "/deployments/:id/rollback" },
    inputSchema: obj({ id: { type: "string", description: "deployment id" } }, ["id"]),
  },
  {
    name: "list_deployments",
    description: "List an app's deployments",
    permission: "deployment:read",
    rest: { method: "GET", path: "/apps/:appId/deployments" },
    inputSchema: obj(
      { appId: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } },
      ["appId"],
    ),
  },
  {
    name: "tail_logs",
    description: "Read a deployment's persisted logs",
    permission: "deployment:read",
    rest: { method: "GET", path: "/deployments/:id/logs" },
    inputSchema: obj({ id: { type: "string" }, sinceSeq: { type: "integer", minimum: 0 } }, ["id"]),
  },
  {
    name: "set_env",
    description: "Replace an app's environment variables",
    permission: "env:write",
    rest: { method: "PUT", path: "/apps/:appId/env" },
    inputSchema: obj(
      {
        appId: { type: "string" },
        vars: {
          type: "array",
          items: obj(
            {
              key: { type: "string" },
              value: { type: "string" },
              secret: { type: "boolean" },
            },
            ["key", "value"],
          ),
        },
      },
      ["appId", "vars"],
    ),
  },
  {
    name: "add_domain",
    description: "Add a domain to an app",
    permission: "domain:write",
    rest: { method: "POST", path: "/apps/:appId/domains" },
    inputSchema: obj(
      { appId: { type: "string" }, fqdn: { type: "string" }, https: { type: "boolean" } },
      ["appId", "fqdn"],
    ),
  },
  // Managed email (R9) — let an agent provision mailboxes and read DNS.
  {
    name: "list_mail_instances",
    description: "List managed-email instances in the org",
    permission: "mail:read",
    rest: { method: "GET", path: "/mail/instances" },
    inputSchema: obj({}),
  },
  {
    name: "add_mail_domain",
    description: "Add a mail domain to an email instance (creates it + DKIM + DNS records)",
    permission: "mail:write",
    rest: { method: "POST", path: "/mail/instances/:id/domains" },
    inputSchema: obj(
      {
        id: { type: "string", description: "mail instance id" },
        fqdn: { type: "string" },
        dnsMode: { type: "string", enum: ["auto", "hint"] },
      },
      ["id", "fqdn"],
    ),
  },
  {
    name: "get_mail_dns",
    description: "Get the required DNS records (+ verification status) for a mail domain",
    permission: "mail:read",
    rest: { method: "GET", path: "/mail/domains/:id/dns" },
    inputSchema: obj({ id: { type: "string", description: "mail domain id" } }, ["id"]),
  },
  {
    name: "create_mailbox",
    description: "Create a mailbox on a mail domain (returns a one-time password)",
    permission: "mail:write",
    rest: { method: "POST", path: "/mail/domains/:id/mailboxes" },
    inputSchema: obj(
      {
        id: { type: "string", description: "mail domain id" },
        localPart: { type: "string" },
        displayName: { type: "string" },
      },
      ["id", "localPart"],
    ),
  },
];

export function findTool(name: string): McpTool | undefined {
  return MCP_TOOLS.find((t) => t.name === name);
}

export function toolPermission(name: string): Permission | undefined {
  return findTool(name)?.permission;
}

export interface RestCall {
  method: McpTool["rest"]["method"];
  url: string;
  body?: Record<string, unknown>;
}

/** Pure: (tool, args) → the REST request. Path params come out of args (a
 *  missing one throws — the schema marks them required); the leftovers ride
 *  the query string for GET/DELETE and the JSON body otherwise. */
export function buildRestCall(tool: McpTool, args: Record<string, unknown>): RestCall {
  const used = new Set<string>();
  const path = tool.rest.path.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    const value = args[name];
    if (value === undefined || value === null || value === "") {
      throw new Error(`missing required argument: ${name}`);
    }
    used.add(name);
    return encodeURIComponent(String(value));
  });
  const leftovers = Object.entries(args).filter(([k, v]) => !used.has(k) && v !== undefined);

  if (tool.rest.method === "GET" || tool.rest.method === "DELETE") {
    const qs = leftovers
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    return { method: tool.rest.method, url: qs ? `${path}?${qs}` : path };
  }
  return { method: tool.rest.method, url: path, body: Object.fromEntries(leftovers) };
}
