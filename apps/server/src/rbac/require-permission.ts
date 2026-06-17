import { AppError } from "@ss/shared";
import type { preHandlerAsyncHookHandler } from "fastify";

import type { RequestContext } from "../lib/ctx.js";

import type { Permission } from "./permissions.js";
import { roleGrants } from "./roles.js";

export type PermissionCheck = { ok: true } | { ok: false; status: number; code: string };

/**
 * Pure authorization decision: (1) authenticated? (2) does the role grant the
 * permission? (3) for API keys, is the permission within the key's scopes
 * (role ∩ scopes — a key can never exceed its creator's role). Resource-scope /
 * tenant-isolation checks (404 cross-tenant) are added with the DB layer.
 */
export function checkPermission(
  ctx: RequestContext | undefined,
  perm: Permission,
): PermissionCheck {
  if (!ctx || ctx.via === "anonymous" || !ctx.role || !ctx.organizationId) {
    return { ok: false, status: 401, code: "auth.unauthenticated" };
  }
  if (!roleGrants(ctx.role, perm)) {
    return { ok: false, status: 403, code: "auth.forbidden" };
  }
  if (ctx.scopes && !ctx.scopes.includes(perm)) {
    return { ok: false, status: 403, code: "auth.scope_insufficient" };
  }
  return { ok: true };
}

export function requirePermission(perm: Permission): preHandlerAsyncHookHandler {
  return async (req) => {
    const result = checkPermission(req.ctx, perm);
    if (!result.ok) {
      throw new AppError(result.code, { status: result.status, code: result.code });
    }
  };
}
