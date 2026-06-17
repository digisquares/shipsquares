import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

// Route wiring + auth surface (no DB/auth in the unit env — RBAC decisions are
// proven in rbac/roles.test.ts; behaviour is proven in the pglite service test).
// A 401 (not 404) confirms each endpoint is registered AND permission-gated.

describe("Database Studio routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  // A valid body where one is required, so the request reaches the auth gate
  // rather than failing body validation first (Fastify validates before preHandler).
  const validProfile = {
    name: "x",
    engine: "postgres",
    host: "db.example.com",
    port: 5432,
    database: "d",
    username: "u",
    password: "p",
  };
  const cases: [string, string, unknown?][] = [
    ["GET", "/api/v1/db-connections"],
    ["POST", "/api/v1/db-connections", validProfile],
    ["DELETE", "/api/v1/db-connections/ext:dbc_x"],
    ["POST", "/api/v1/db-connections/ext:dbc_x/test"],
    ["GET", "/api/v1/db-connections/ext:dbc_x/schema"],
    ["GET", "/api/v1/db-connections/ext:dbc_x/tables/public/users"],
    ["GET", "/api/v1/db-connections/ext:dbc_x/tables/public/users/rows"],
    ["POST", "/api/v1/db-connections/ext:dbc_x/query", { sql: "select 1" }],
    [
      "POST",
      "/api/v1/db-connections/ext:dbc_x/edits",
      { edits: [{ op: "insert", schema: "s", table: "t", values: { a: 1 } }] },
    ],
  ];

  it.each(cases)(
    "%s %s requires authentication (401, registered + gated)",
    async (method, url, payload) => {
      const res = await app.inject({
        method: method as "GET",
        url,
        ...(payload ? { payload } : {}),
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("auth.unauthenticated");
    },
  );

  it("rejects an unknown sibling path with 404 (proves the 401s are gating, not catch-all)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/db-connections-nope" });
    expect(res.statusCode).toBe(404);
  });
});
