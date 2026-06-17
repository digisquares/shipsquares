import { describe, expect, it } from "vitest";

import { auditEventFromRequest, dbStudioAuditEvent } from "./audit.service.js";

const ctx = {
  via: "session" as const,
  actor: { userId: "usr_1" },
  organizationId: "org_1",
  role: "owner" as const,
  scopes: null,
};

const req = (over: Record<string, unknown> = {}) => ({
  method: "POST",
  routeUrl: "/api/v1/apps",
  params: {},
  statusCode: 201,
  ctx,
  ...over,
});

describe("auditEventFromRequest", () => {
  it("maps a create mutation with actor + org", () => {
    expect(auditEventFromRequest(req())).toEqual({
      organizationId: "org_1",
      actorUserId: "usr_1",
      actorApiKeyId: null,
      action: "create",
      resourceType: "apps",
      resourceId: null,
      metadata: { method: "POST", route: "/api/v1/apps", status: 201 },
    });
  });

  it("derives delete/update verbs and the resource id from params", () => {
    const del = auditEventFromRequest(
      req({
        method: "DELETE",
        routeUrl: "/api/v1/apps/:id",
        params: { id: "app_1" },
        statusCode: 204,
      }),
    );
    expect(del).toMatchObject({ action: "delete", resourceType: "apps", resourceId: "app_1" });
    const upd = auditEventFromRequest(
      req({
        method: "PATCH",
        routeUrl: "/api/v1/apps/:id",
        params: { id: "app_1" },
        statusCode: 200,
      }),
    );
    expect(upd).toMatchObject({ action: "update" });
  });

  it("uses a trailing action segment as the verb (rollback/run/test)", () => {
    const rb = auditEventFromRequest(
      req({
        routeUrl: "/api/v1/deployments/:id/rollback",
        params: { id: "dpl_1" },
        statusCode: 202,
      }),
    );
    expect(rb).toMatchObject({
      action: "rollback",
      resourceType: "deployments",
      resourceId: "dpl_1",
    });
    const run = auditEventFromRequest(
      req({ routeUrl: "/api/v1/schedules/:id/run", params: { id: "job_1" }, statusCode: 202 }),
    );
    expect(run).toMatchObject({ action: "run", resourceType: "schedules" });
  });

  it("does not generically audit Database Studio query/test/edits (self-audited at the route)", () => {
    for (const routeUrl of [
      "/api/v1/db-connections/:id/query",
      "/api/v1/db-connections/:id/test",
      "/api/v1/db-connections/:id/edits",
    ]) {
      expect(
        auditEventFromRequest(req({ routeUrl, params: { id: "ext:dbc_1" }, statusCode: 200 })),
      ).toBeNull();
    }
  });

  it("dbStudioAuditEvent builds a db-connections write event (or null without an org)", () => {
    expect(dbStudioAuditEvent(ctx, "edits", "ext:dbc_1", { applied: 2 })).toMatchObject({
      organizationId: "org_1",
      actorUserId: "usr_1",
      actorApiKeyId: null,
      action: "edits",
      resourceType: "db-connections",
      resourceId: "ext:dbc_1",
      metadata: { applied: 2 },
    });
    expect(
      dbStudioAuditEvent({ ...ctx, organizationId: null }, "query", "ext:dbc_1", {}),
    ).toBeNull();
  });

  it("falls back to appId params for child resources", () => {
    const e = auditEventFromRequest(
      req({ routeUrl: "/api/v1/apps/:appId/domains", params: { appId: "app_1" }, statusCode: 201 }),
    );
    expect(e).toMatchObject({ resourceType: "apps", resourceId: "app_1" });
  });

  it("returns null for reads, failures, and unauthenticated/public requests", () => {
    expect(auditEventFromRequest(req({ method: "GET", statusCode: 200 }))).toBeNull();
    expect(auditEventFromRequest(req({ statusCode: 409 }))).toBeNull();
    expect(auditEventFromRequest(req({ ctx: { ...ctx, organizationId: null } }))).toBeNull();
    expect(auditEventFromRequest(req({ routeUrl: "/hooks/:id" }))).toBeNull(); // not /api/v1
  });
});
