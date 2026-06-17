#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { HttpApiClient } from "./api.js";
import { buildMcpServer, MCP_SERVER_NAME } from "./server.js";

// MCP server entrypoint (13-mcp-server.md): exposes the control-plane tools to AI
// agents over stdio. Launched by an MCP client (Claude Desktop/IDE/the chatbot)
// with SHIPSQUARES_URL + SHIPSQUARES_COOKIE in its env. stdout is the JSON-RPC
// channel — diagnostics go to stderr only.
export { MCP_SERVER_NAME };

async function main(): Promise<void> {
  const url = process.env.SHIPSQUARES_URL ?? "";
  if (!url) {
    process.stderr.write("SHIPSQUARES_URL is required (the control-plane base URL).\n");
    process.exit(1);
  }
  const api = new HttpApiClient(
    url,
    process.env.SHIPSQUARES_COOKIE,
    process.env.SHIPSQUARES_API_KEY,
  );
  const server = buildMcpServer(api);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`${MCP_SERVER_NAME} ready (${url})\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`MCP server failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
