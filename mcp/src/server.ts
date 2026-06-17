import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import type { Api } from "./api.js";
import { TOOLS, callTool } from "./tools.js";

export const MCP_SERVER_NAME = "shipsquares-mcp";

// Build the low-level MCP Server with the tool catalog wired to the API. Using
// the low-level Server (not McpServer) keeps zod out of our code — tool inputs
// are JSON Schema and request routing uses the SDK's own pre-built schemas.
export function buildMcpServer(api: Api): Server {
  const server = new Server(
    { name: MCP_SERVER_NAME, version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const text = await callTool(api, req.params.name, req.params.arguments ?? {});
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  });

  return server;
}
