import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

describe("apps routes — contract", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("rejects an invalid CreateApp body → 400 problem+json validation.failed", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/apps", payload: { name: "" } });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json();
    expect(body.code).toBe("validation.failed");
    expect(Array.isArray(body.errors)).toBe(true);
  });

  it("rejects additionalProperties on a create body (strict)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/apps",
      payload: { name: "ok", bogus: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it("denies an anonymous request → 401 auth.unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/apps?limit=50" });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("auth.unauthenticated");
  });

  it("rejects a limit over the max → 400", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/apps?limit=500" });
    expect(res.statusCode).toBe(400);
  });

  it("serves the generated OpenAPI spec including the apps paths", async () => {
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toBeTruthy();
    expect(Object.keys(spec.paths).some((p: string) => p.includes("/apps"))).toBe(true);
  });
});
