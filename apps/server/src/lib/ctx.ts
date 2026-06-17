import { UnauthorizedError } from "@ss/shared";
import type { FastifyRequest } from "fastify";

import type { Permission } from "../rbac/permissions.js";

export type Role = "owner" | "admin" | "deployer" | "viewer";

// The per-request authorization context. Session, API-key, and MCP credentials
// all resolve to this same shape, so REST (04), MCP (13), and webhook flows (10)
// share one authorization story. `scopes` is null for sessions (full role) and a
// permission subset for API keys (05-auth-rbac.md).
export interface RequestContext {
  via: "session" | "apiKey" | "anonymous";
  actor: { userId?: string; apiKeyId?: string; email?: string };
  organizationId: string | null;
  role: Role | null;
  scopes: Permission[] | null;
}

export function getCtx(req: FastifyRequest): RequestContext {
  if (!req.ctx) throw new UnauthorizedError("authentication required");
  return req.ctx;
}

/**
 * The authenticated actor's active organization id. requirePermission already
 * guarantees it's set for protected routes; this narrows it for the services and
 * is the single source of org scope (never the request body — closes IDOR).
 */
export function getOrgId(req: FastifyRequest): string {
  const ctx = getCtx(req);
  if (!ctx.organizationId) throw new UnauthorizedError("no active organization");
  return ctx.organizationId;
}
