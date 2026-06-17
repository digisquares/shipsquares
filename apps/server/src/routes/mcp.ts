import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AppError } from "@ss/shared";
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";

import { MCP_TOOLS, buildRestCall, findTool } from "../mcp/tools.js";
import { checkPermission } from "../rbac/require-permission.js";

// MCP over streamable HTTP (13-mcp-server.md): STATELESS — every POST builds a
// fresh Server + transport pair (no session store; enableJsonResponse, so no
// SSE push). Auth rides the platform credential (bearer API key or session
// cookie) the auth plugin already resolved into req.ctx, and every tool call
// re-enters the REST API via app.inject carrying the SAME credential — RBAC,
// validation, and the audit trail apply exactly as they do for web/CLI
// traffic. The low-level Server + JSON-Schema tools keep zod off our boundary
// (the documented 13 deviation).

function credentialHeaders(req: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof req.headers.authorization === "string") {
    headers.authorization = req.headers.authorization;
  }
  if (typeof req.headers.cookie === "string") headers.cookie = req.headers.cookie;
  return headers;
}

function buildServerFor(app: FastifyInstance, req: FastifyRequest): Server {
  const ctx = req.ctx;
  const auth = credentialHeaders(req);
  const server = new Server(
    { name: "shipsquares", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // Only the tools this credential could actually use (role ∩ key scopes).
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: MCP_TOOLS.filter((t) => checkPermission(ctx, t.permission).ok).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (mcpReq) => {
    const tool = findTool(mcpReq.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `unknown tool: ${mcpReq.params.name}` }],
        isError: true,
      };
    }
    try {
      const call = buildRestCall(tool, (mcpReq.params.arguments ?? {}) as Record<string, unknown>);
      const res = await app.inject({
        method: call.method,
        url: `/api/v1${call.url}`,
        headers: {
          ...auth,
          ...(call.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(call.body !== undefined ? { payload: call.body } : {}),
      });
      return {
        content: [{ type: "text", text: res.body || `HTTP ${res.statusCode}` }],
        ...(res.statusCode >= 400 ? { isError: true } : {}),
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  });

  return server;
}

export const mcpRoutes: FastifyPluginAsync = async (app) => {
  app.post("/mcp", async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx || ctx.via === "anonymous" || !ctx.organizationId) {
      throw new AppError("authentication required (bearer API key or session)", {
        status: 401,
        code: "auth.unauthenticated",
      });
    }

    const server = buildServerFor(app, req);
    const transport = new StreamableHTTPServerTransport({
      // no sessionIdGenerator → stateless: no session to track
      enableJsonResponse: true, // plain JSON answers; tools need no SSE push
    });
    // The SDK writes the raw response itself — keep Fastify's hands off it.
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport as Transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  // Stateless transport: no SSE stream to resume, no session to delete.
  for (const method of ["GET", "DELETE"] as const) {
    app.route({
      method,
      url: "/mcp",
      handler: async (_req, reply) =>
        reply.code(405).send({ error: "stateless MCP transport — POST JSON-RPC messages to /mcp" }),
    });
  }
};
