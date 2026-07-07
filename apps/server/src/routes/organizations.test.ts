import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

// Route wiring for the org endpoints (C6). No auth in the unit env, so a
// registered+gated route answers 401 and a removed route answers 404 — which is
// exactly what we assert. Behaviour is proven in the pglite service test.
describe("organizations routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("keeps GET/PATCH /organizations/:id (registered + permission-gated → 401)", async () => {
    const get = await app.inject({ method: "GET", url: "/api/v1/organizations/org_x" });
    expect(get.statusCode).toBe(401);
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/organizations/org_x",
      payload: { name: "New name" },
    });
    expect(patch.statusCode).toBe(401);
  });

  it("keeps the org-switcher routes gated", async () => {
    const me = await app.inject({ method: "GET", url: "/api/v1/me/organizations" });
    expect(me.statusCode).toBe(401);
    const activate = await app.inject({
      method: "POST",
      url: "/api/v1/organizations/org_x/activate",
    });
    expect(activate.statusCode).toBe(401);
  });

  it("drops the out-of-scope routes (no 501 stubs → 404 unregistered)", async () => {
    // unregistered → 404 regardless of body; explicit calls keep inject's
    // overload resolution happy (a union-typed method confuses it).
    expect((await app.inject({ method: "GET", url: "/api/v1/organizations" })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ method: "POST", url: "/api/v1/organizations" })).statusCode).toBe(
      404,
    );
    expect(
      (await app.inject({ method: "DELETE", url: "/api/v1/organizations/org_x" })).statusCode,
    ).toBe(404);
  });
});
