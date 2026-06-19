import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

describe("login-flow routes — contract", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("GET /login/flow bounces to the SPA consent hash (default redirect)", async () => {
    const res = await app.inject({ method: "GET", url: "/login/flow" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/#/login-flow?redirect=ss%3A%2F%2Flogin");
  });

  it("GET /login/flow preserves a valid ss://login redirect", async () => {
    const res = await app.inject({ method: "GET", url: "/login/flow?redirect=ss://login" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/#/login-flow?redirect=ss%3A%2F%2Flogin");
  });

  it("GET /login/flow rejects a non-app redirect target", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/login/flow?redirect=${encodeURIComponent("https://evil.example")}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST authorize denies an anonymous request → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/login/flow/authorize",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST authorize rejects additionalProperties (strict body)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/login/flow/authorize",
      payload: { bogus: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it("publishes the authorize path in the OpenAPI spec", async () => {
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(Object.keys(spec.paths)).toContain("/login/flow/authorize");
  });
});
