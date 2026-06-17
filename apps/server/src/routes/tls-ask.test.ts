import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

describe("GET /internal/tls/ask — contract", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("refuses non-loopback callers outright (Caddy is local)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/internal/tls/ask?domain=any.example.com",
      remoteAddress: "203.0.113.9",
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ allow: false });
  });

  it("rejects a missing domain param", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/internal/tls/ask",
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(400);
  });
});
