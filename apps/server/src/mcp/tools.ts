import type { Permission } from "../rbac/permissions.js";

// The MCP tool catalog (13-mcp-server.md). Each tool is a thin wrapper over the
// REST API (04) carrying the SAME required permission (05) — one authorization
// story for web, mobile, and agents. Inputs are plain JSON Schema (the SDK's
// zod stays off our boundary); buildRestCall turns (tool, args) into the API
// request the streamable-HTTP route replays via app.inject.

export type ToolRisk = "read" | "write" | "destructive";

export interface McpTool {
  name: string;
  description: string;
  permission: Permission;
  rest: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string };
  inputSchema: Record<string, unknown>;
  /** Risk tier driving the in-product assistant's approval gate (auto-update.md
   *  sibling: ai-assistant-roadmap.md). Defaults via {@link toolRisk}: GET ⇒ read,
   *  mutating ⇒ write. Set explicitly to "destructive" for irreversible actions
   *  (delete, restore, rotate) — `read` auto-runs; write/destructive need approval. */
  risk?: ToolRisk;
}

/** Effective risk tier — explicit `risk`, else derived from the HTTP method. */
export function toolRisk(tool: McpTool): ToolRisk {
  return tool.risk ?? (tool.rest.method === "GET" ? "read" : "write");
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

  // ── Read/inspect coverage (ai-assistant-roadmap.md Phase 1) ──
  // GET wrappers across the remaining domains. All derive risk = "read" (toolRisk),
  // so they auto-run — no approval needed — and each carries the route's real
  // permission so the assistant only offers what the caller can use.
  {
    name: "list_servers",
    description: "List servers in the fleet",
    permission: "server:read",
    rest: { method: "GET", path: "/servers" },
    inputSchema: obj({ limit: { type: "integer", minimum: 1, maximum: 100 } }),
  },
  {
    name: "get_server",
    description: "Get a server's detail + health",
    permission: "server:read",
    rest: { method: "GET", path: "/servers/:id" },
    inputSchema: obj({ id: { type: "string", description: "server id" } }, ["id"]),
  },
  {
    name: "server_metrics",
    description: "Get a server's metrics time series (cpu/memory/disk)",
    permission: "server:read",
    rest: { method: "GET", path: "/servers/:id/metrics/series" },
    inputSchema: obj(
      {
        id: { type: "string", description: "server id" },
        metric: { type: "string", enum: ["cpu", "memory", "disk"] },
        range: { type: "string", description: "e.g. 1h, 24h, 7d" },
      },
      ["id"],
    ),
  },
  {
    name: "list_databases",
    description: "List provisioned managed databases",
    permission: "server:read",
    rest: { method: "GET", path: "/databases" },
    inputSchema: obj({}),
  },
  {
    name: "list_database_servers",
    description: "List managed database servers",
    permission: "server:read",
    rest: { method: "GET", path: "/database-servers" },
    inputSchema: obj({}),
  },
  {
    name: "list_db_replicas",
    description: "List database replicas",
    permission: "server:read",
    rest: { method: "GET", path: "/db-replicas" },
    inputSchema: obj({}),
  },
  {
    name: "list_backup_configs",
    description: "List database backup configurations",
    permission: "server:read",
    rest: { method: "GET", path: "/backup-configs" },
    inputSchema: obj({}),
  },
  {
    name: "list_backup_runs",
    description: "List runs for a backup configuration",
    permission: "server:read",
    rest: { method: "GET", path: "/backup-configs/:id/runs" },
    inputSchema: obj({ id: { type: "string", description: "backup config id" } }, ["id"]),
  },
  {
    name: "list_catalog",
    description: "List one-click catalog templates (name, slug, category) to install",
    permission: "app:read",
    rest: { method: "GET", path: "/catalog" },
    inputSchema: obj({}),
  },
  {
    name: "get_catalog_template",
    description: "Get a catalog template's composed config by slug",
    permission: "app:read",
    rest: { method: "GET", path: "/catalog/:slug" },
    inputSchema: obj({ slug: { type: "string" } }, ["slug"]),
  },
  {
    name: "list_catalog_services",
    description: "List installed catalog services (databases, tools) in the org",
    permission: "server:read",
    rest: { method: "GET", path: "/catalog-services" },
    inputSchema: obj({}),
  },
  {
    name: "list_metric_alerts",
    description: "List metric threshold alerts",
    permission: "app:read",
    rest: { method: "GET", path: "/metric-alerts" },
    inputSchema: obj({}),
  },
  {
    name: "list_previews",
    description: "List an app's PR preview environments",
    permission: "app:read",
    rest: { method: "GET", path: "/apps/:appId/previews" },
    inputSchema: obj({ appId: { type: "string" } }, ["appId"]),
  },
  {
    name: "list_schedules",
    description: "List scheduled (cron) jobs",
    permission: "app:read",
    rest: { method: "GET", path: "/schedules" },
    inputSchema: obj({}),
  },
  {
    name: "list_schedule_runs",
    description: "List a scheduled job's recent run history",
    permission: "app:read",
    rest: { method: "GET", path: "/schedules/:id/runs" },
    inputSchema: obj({ id: { type: "string", description: "schedule id" } }, ["id"]),
  },
  {
    name: "list_members",
    description: "List org members and their roles",
    permission: "member:read",
    rest: { method: "GET", path: "/members" },
    inputSchema: obj({}),
  },
  {
    name: "list_notification_channels",
    description: "List notification channels (Slack, email, webhook)",
    permission: "app:read",
    rest: { method: "GET", path: "/notification-channels" },
    inputSchema: obj({}),
  },
  // Database Studio (read) — inspect schema + browse data via chat.
  {
    name: "list_db_connections",
    description: "List Database Studio connections (managed + external)",
    permission: "dbstudio:read",
    rest: { method: "GET", path: "/db-connections" },
    inputSchema: obj({}),
  },
  {
    name: "get_db_schema",
    description: "Get the schema tree (tables/views) for a database connection",
    permission: "dbstudio:read",
    rest: { method: "GET", path: "/db-connections/:id/schema" },
    inputSchema: obj({ id: { type: "string", description: "db connection id" } }, ["id"]),
  },
  {
    name: "browse_table",
    description: "Browse rows of a table (paginated) — e.g. 'show the 10 newest users'",
    permission: "dbstudio:read",
    rest: { method: "GET", path: "/db-connections/:id/tables/:schema/:table/rows" },
    inputSchema: obj(
      {
        id: { type: "string", description: "db connection id" },
        schema: { type: "string" },
        table: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
        offset: { type: "integer", minimum: 0 },
      },
      ["id", "schema", "table"],
    ),
  },

  // ── Write/destructive coverage (ai-assistant-roadmap.md Phase 1) ──
  // Mutations the assistant proposes; the in-product approval gate confirms each
  // before it runs. Deletes/restores are tagged "destructive" so the card warns.
  {
    name: "create_app",
    description: "Create a new app (from a repo or image)",
    permission: "app:write",
    rest: { method: "POST", path: "/apps" },
    inputSchema: obj(
      {
        name: { type: "string" },
        repo: { type: "string" },
        image: { type: "string" },
        branch: { type: "string" },
        port: { type: "integer" },
        serverId: { type: "string" },
      },
      ["name"],
    ),
  },
  {
    name: "restart_app",
    description: "Restart an app",
    permission: "app:write",
    rest: { method: "POST", path: "/apps/:id/restart" },
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "stop_app",
    description: "Stop an app",
    permission: "app:write",
    rest: { method: "POST", path: "/apps/:id/stop" },
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "start_app",
    description: "Start a stopped app",
    permission: "app:write",
    rest: { method: "POST", path: "/apps/:id/start" },
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "delete_app",
    description: "Delete an app and tear down its containers",
    permission: "app:write",
    risk: "destructive",
    rest: { method: "DELETE", path: "/apps/:id" },
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "add_server",
    description: "Add a server to the fleet (agentless SSH bootstrap)",
    permission: "server:write",
    rest: { method: "POST", path: "/servers" },
    inputSchema: obj(
      {
        name: { type: "string" },
        host: { type: "string" },
        sshPort: { type: "integer" },
        sshUser: { type: "string" },
      },
      ["name", "host"],
    ),
  },
  {
    name: "remove_server",
    description: "Remove a server from the fleet",
    permission: "server:write",
    risk: "destructive",
    rest: { method: "DELETE", path: "/servers/:id" },
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "create_database",
    description: "Provision a managed database on a server",
    permission: "server:write",
    rest: { method: "POST", path: "/databases" },
    inputSchema: obj(
      { serverId: { type: "string" }, name: { type: "string" }, appId: { type: "string" } },
      ["serverId", "name"],
    ),
  },
  {
    name: "delete_database",
    description: "Drop a managed database",
    permission: "server:write",
    risk: "destructive",
    rest: { method: "DELETE", path: "/databases/:id" },
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "run_backup",
    description: "Trigger a backup for a backup configuration",
    permission: "server:write",
    rest: { method: "POST", path: "/backup-configs/:id/run" },
    inputSchema: obj({ id: { type: "string", description: "backup config id" } }, ["id"]),
  },
  {
    name: "restore_backup",
    description: "Restore a database from a backup run (overwrites the target database)",
    permission: "server:write",
    risk: "destructive",
    rest: { method: "POST", path: "/backup-configs/:id/runs/:runId/restore" },
    inputSchema: obj(
      { id: { type: "string", description: "backup config id" }, runId: { type: "string" } },
      ["id", "runId"],
    ),
  },
  {
    name: "install_catalog",
    description: "Install a one-click catalog app/service by slug (e.g. plausible, umami)",
    permission: "server:write",
    rest: { method: "POST", path: "/catalog-services" },
    inputSchema: obj({ slug: { type: "string" }, name: { type: "string" } }, ["slug"]),
  },
  {
    name: "uninstall_catalog",
    description: "Uninstall a catalog service",
    permission: "server:write",
    risk: "destructive",
    rest: { method: "DELETE", path: "/catalog-services/:id" },
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "create_schedule",
    description: "Create a scheduled (cron) job",
    permission: "app:write",
    rest: { method: "POST", path: "/schedules" },
    inputSchema: obj(
      {
        name: { type: "string" },
        target: { type: "string", enum: ["app_container", "service", "server"] },
        appId: { type: "string" },
        serverId: { type: "string" },
        command: { type: "string" },
        cron: { type: "string" },
        timezone: { type: "string" },
      },
      ["name", "target", "command", "cron"],
    ),
  },
  {
    name: "run_schedule",
    description: "Run a scheduled job now",
    permission: "app:write",
    rest: { method: "POST", path: "/schedules/:id/run" },
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "delete_schedule",
    description: "Delete a scheduled job",
    permission: "app:write",
    risk: "destructive",
    rest: { method: "DELETE", path: "/schedules/:id" },
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "invite_member",
    description: "Invite a member to the org at a role",
    permission: "member:write",
    rest: { method: "POST", path: "/members/invites" },
    inputSchema: obj(
      {
        email: { type: "string" },
        role: { type: "string", enum: ["owner", "admin", "deployer", "viewer"] },
      },
      ["email", "role"],
    ),
  },
  {
    name: "set_member_role",
    description: "Change an org member's role",
    permission: "member:write",
    rest: { method: "PATCH", path: "/members/:id" },
    inputSchema: obj(
      {
        id: { type: "string" },
        role: { type: "string", enum: ["owner", "admin", "deployer", "viewer"] },
      },
      ["id", "role"],
    ),
  },
  {
    name: "remove_member",
    description: "Remove a member from the org",
    permission: "member:write",
    risk: "destructive",
    rest: { method: "DELETE", path: "/members/:id" },
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "create_metric_alert",
    description: "Create a metric threshold alert (cpu/mem on a server or app)",
    permission: "app:write",
    rest: { method: "POST", path: "/metric-alerts" },
    inputSchema: obj(
      {
        scope: { type: "string", enum: ["server", "app"] },
        targetId: { type: "string" },
        metric: { type: "string", enum: ["cpu", "mem"] },
        thresholdPct: { type: "integer", minimum: 1, maximum: 100 },
        windowSeconds: { type: "integer" },
      },
      ["scope", "targetId", "metric", "thresholdPct"],
    ),
  },
  {
    name: "delete_metric_alert",
    description: "Delete a metric alert",
    permission: "app:write",
    risk: "destructive",
    rest: { method: "DELETE", path: "/metric-alerts/:id" },
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
  },
];

export function findTool(name: string): McpTool | undefined {
  return MCP_TOOLS.find((t) => t.name === name);
}

export interface ToolCategory {
  name: string;
  description: string;
  tools: string[];
}

// Categories for the Haiku tool-picker (ai-assistant-roadmap.md): a small model maps
// the user's intent → relevant categories, and the main agent carries only those
// categories' tools — keeping its context focused as the catalog grows. The
// "covers every tool exactly once" test guards this list against drift.
export const TOOL_CATEGORIES: ToolCategory[] = [
  {
    name: "apps",
    description: "apps, deploy/rollback, logs, env vars, custom domains, PR previews, lifecycle",
    tools: [
      "list_apps",
      "get_status",
      "deploy_app",
      "rollback",
      "list_deployments",
      "tail_logs",
      "set_env",
      "add_domain",
      "list_previews",
      "create_app",
      "restart_app",
      "stop_app",
      "start_app",
      "delete_app",
    ],
  },
  {
    name: "servers",
    description: "servers/fleet — list, metrics, add (SSH bootstrap), remove",
    tools: ["list_servers", "get_server", "server_metrics", "add_server", "remove_server"],
  },
  {
    name: "databases",
    description:
      "managed databases, replicas, backups + restore, and Database Studio (schema + browse rows)",
    tools: [
      "list_databases",
      "list_database_servers",
      "list_db_replicas",
      "list_backup_configs",
      "list_backup_runs",
      "list_db_connections",
      "get_db_schema",
      "browse_table",
      "create_database",
      "delete_database",
      "run_backup",
      "restore_backup",
    ],
  },
  {
    name: "catalog",
    description: "one-click catalog templates + installed services (install/uninstall)",
    tools: [
      "list_catalog",
      "get_catalog_template",
      "list_catalog_services",
      "install_catalog",
      "uninstall_catalog",
    ],
  },
  {
    name: "email",
    description: "managed email instances, domains, DNS, and mailboxes",
    tools: ["list_mail_instances", "add_mail_domain", "get_mail_dns", "create_mailbox"],
  },
  {
    name: "observability",
    description: "metric threshold alerts (create/delete)",
    tools: ["list_metric_alerts", "create_metric_alert", "delete_metric_alert"],
  },
  {
    name: "jobs",
    description: "scheduled (cron) jobs — list, create, run, delete, run history",
    tools: [
      "list_schedules",
      "list_schedule_runs",
      "create_schedule",
      "run_schedule",
      "delete_schedule",
    ],
  },
  {
    name: "org",
    description: "org members (invite/role/remove) and notification channels",
    tools: [
      "list_members",
      "list_notification_channels",
      "invite_member",
      "set_member_role",
      "remove_member",
    ],
  },
];

export const TOOL_CATEGORY_NAMES = TOOL_CATEGORIES.map((c) => c.name);

/** The tools belonging to any of the given category names. */
export function toolsForCategories(names: readonly string[]): McpTool[] {
  const want = new Set(
    TOOL_CATEGORIES.filter((c) => names.includes(c.name)).flatMap((c) => c.tools),
  );
  return MCP_TOOLS.filter((t) => want.has(t.name));
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
