import { and, asc, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";

import { db } from "../db/index.js";
import { apiKeys, memberships } from "../db/schema/index.js";
import type { RequestContext, Role } from "../lib/ctx.js";
import type { Permission } from "../rbac/permissions.js";

import { hashApiKey, parseBearer } from "./api-key-core.js";
import type { Auth } from "./better-auth.js";

// Anonymous context — protected routes 401 at requirePermission.
export const ANON: RequestContext = {
  via: "anonymous",
  actor: {},
  organizationId: null,
  role: null,
  scopes: null,
};

/**
 * Resolve the actor's org + role from `memberships` (03/05). When the session
 * has no active org, fall back to the actor's (single, bootstrap) membership.
 * Returns null when the user has no membership in the (active) org → 401.
 */
export async function roleFor(
  userId: string,
  orgId: string | null,
): Promise<{ organizationId: string; role: Role } | null> {
  const where = orgId
    ? and(eq(memberships.userId, userId), eq(memberships.organizationId, orgId))
    : eq(memberships.userId, userId);
  // Deterministic for multi-org users: oldest membership wins until org
  // switching exists — without an order, the org could flip between requests.
  const rows = await db
    .select({ organizationId: memberships.organizationId, role: memberships.role })
    .from(memberships)
    .where(where)
    .orderBy(asc(memberships.createdAt), asc(memberships.organizationId))
    .limit(1);
  const m = rows[0];
  return m ? { organizationId: m.organizationId, role: m.role as Role } : null;
}

/** The raw better-auth session (id + user), independent of org membership —
 *  for endpoints that must work before the actor belongs to any org (invite
 *  accept) or that need the session id (org switch). Returns null if no valid
 *  session cookie. */
export async function rawSession(
  auth: Auth,
  req: FastifyRequest,
): Promise<{ userId: string; email: string; sessionId: string } | null> {
  const session = await auth.api.getSession({ headers: toHeaders(req.headers) });
  if (!session?.user) return null;
  return {
    userId: session.user.id,
    email: session.user.email,
    sessionId: session.session.id,
  };
}

function toHeaders(raw: FastifyRequest["headers"]): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) headers.set(k, v.join(", "));
    else if (v != null) headers.set(k, String(v));
  }
  return headers;
}

/** Bearer ss_live_ token → hash lookup → org-scoped context. Keys act as a
 *  DEPLOYER (deploy/app surface, no org administration); non-empty scopes
 *  narrow further at requirePermission. lastUsedAt is touched best-effort. */
async function resolveApiKey(token: string): Promise<RequestContext | null> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hashApiKey(token)))
    .limit(1);
  const key = rows[0];
  if (!key) return null;
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .catch(() => undefined);
  return {
    via: "apiKey",
    actor: { apiKeyId: key.id },
    organizationId: key.organizationId,
    role: "deployer",
    scopes: key.scopes.length > 0 ? (key.scopes as Permission[]) : null,
  };
}

/**
 * Credential → RequestContext (05-auth-rbac.md). Bearer ss_live_ API keys
 * resolve first (hash lookup, no session machinery); otherwise the session
 * cookie → user + active org + role. better-auth's getSession short-circuits
 * to null without a DB query when no session cookie is present, so anonymous
 * requests stay DB-free.
 */
export async function resolveContext(auth: Auth, req: FastifyRequest): Promise<RequestContext> {
  const bearer = parseBearer(req.headers.authorization);
  if (bearer) return (await resolveApiKey(bearer)) ?? ANON;

  const session = await auth.api.getSession({ headers: toHeaders(req.headers) });
  if (!session?.user) return ANON;

  const activeOrg =
    (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
  const membership = await roleFor(session.user.id, activeOrg);
  if (!membership) return ANON; // authenticated but not a member of any org

  return {
    via: "session",
    actor: { userId: session.user.id, email: session.user.email },
    organizationId: membership.organizationId,
    role: membership.role,
    scopes: null,
  };
}
