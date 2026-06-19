import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

describe("deployments routes — org-wide feed contract", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("denies an anonymous org-wide deployments request → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/deployments?limit=25" });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("auth.unauthenticated");
  });

  it("rejects a limit over the max → 400", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/deployments?limit=500" });
    expect(res.statusCode).toBe(400);
  });

  it("publishes the org-wide /deployments path in the OpenAPI spec", async () => {
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    const spec = res.json();
    expect(spec.paths["/deployments"]?.get).toBeTruthy();
  });
});
