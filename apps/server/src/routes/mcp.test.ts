import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

describe("POST /mcp — contract", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("rejects an unauthenticated client before speaking MCP", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("auth.unauthenticated");
  });

  it("answers GET/DELETE with 405 (stateless transport)", async () => {
    expect((await app.inject({ method: "GET", url: "/mcp" })).statusCode).toBe(405);
    expect((await app.inject({ method: "DELETE", url: "/mcp" })).statusCode).toBe(405);
  });
});
