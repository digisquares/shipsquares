import { describe, expect, it } from "vitest";

import type { RequestContext, Role } from "../lib/ctx.js";

import type { Permission } from "./permissions.js";
import { checkPermission } from "./require-permission.js";

const session = (role: Role): RequestContext => ({
  via: "session",
  actor: { userId: "usr_1" },
  organizationId: "org_1",
  role,
  scopes: null,
});

const apiKey = (role: Role, scopes: Permission[]): RequestContext => ({
  via: "apiKey",
  actor: { apiKeyId: "key_1" },
  organizationId: "org_1",
  role,
  scopes,
});

describe("checkPermission", () => {
  it("401 for an anonymous/absent ctx before any role check", () => {
    expect(checkPermission(undefined, "app:read")).toEqual({
      ok: false,
      status: 401,
      code: "auth.unauthenticated",
    });
    expect(
      checkPermission(
        { via: "anonymous", actor: {}, organizationId: null, role: null, scopes: null },
        "app:read",
      ),
    ).toMatchObject({ status: 401 });
  });

  it("403 auth.forbidden when the role lacks the permission", () => {
    expect(checkPermission(session("viewer"), "app:write")).toEqual({
      ok: false,
      status: 403,
      code: "auth.forbidden",
    });
  });

  it("allows when the role grants the permission", () => {
    expect(checkPermission(session("admin"), "app:write")).toEqual({ ok: true });
  });

  it("403 auth.scope_insufficient when an API key's scopes exclude the perm", () => {
    expect(checkPermission(apiKey("admin", ["deployment:read"]), "deployment:write")).toEqual({
      ok: false,
      status: 403,
      code: "auth.scope_insufficient",
    });
  });

  it("allows an API key when scope includes the perm and the role grants it", () => {
    expect(checkPermission(apiKey("admin", ["deployment:write"]), "deployment:write")).toEqual({
      ok: true,
    });
  });

  it("an API key can never exceed its creator's role (role checked before scopes)", () => {
    expect(checkPermission(apiKey("viewer", ["app:write"]), "app:write")).toEqual({
      ok: false,
      status: 403,
      code: "auth.forbidden",
    });
  });
});
