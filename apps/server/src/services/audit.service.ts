import { newId } from "@ss/shared";
import { desc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { auditLog } from "../db/schema/index.js";
import type { RequestContext } from "../lib/ctx.js";
import { swallow } from "../lib/swallow.js";

// Audit on every mutation (05-auth-rbac.md): instead of 30 per-route call
// sites, one onResponse hook (plugins/audit.ts) maps each successful authed
// mutation through auditEventFromRequest (pure, unit-tested) and records it
// fire-safe — auditing must never fail or slow the mutation it describes.

export interface AuditEvent {
  organizationId: string;
  actorUserId: string | null;
  actorApiKeyId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
}

const VERB_BY_METHOD: Record<string, string> = {
  POST: "create",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
};

// Database Studio query/test/edits are self-audited at the route (writes get
// statement detail the generic mapper can't see; reads + tests aren't audited).
const DBSTUDIO_SELF_AUDITED = new Set([
  "/api/v1/db-connections/:id/query",
  "/api/v1/db-connections/:id/test",
  "/api/v1/db-connections/:id/edits",
]);

/** Map a finished request to an audit event, or null when nothing should be
 *  recorded (reads, non-2xx, public/anonymous, non-API routes). */
export function auditEventFromRequest(input: {
  method: string;
  routeUrl: string;
  params: Record<string, unknown>;
  statusCode: number;
  ctx: RequestContext;
}): AuditEvent | null {
  const verb = VERB_BY_METHOD[input.method];
  if (!verb) return null;
  if (input.statusCode < 200 || input.statusCode >= 300) return null;
  if (!input.ctx.organizationId) return null;
  if (!input.routeUrl.startsWith("/api/v1/")) return null;
  if (DBSTUDIO_SELF_AUDITED.has(input.routeUrl)) return null;

  const segments = input.routeUrl.slice("/api/v1/".length).split("/").filter(Boolean);
  const resourceType = segments[0] ?? "unknown";
  // A trailing non-param segment is the action ("/deployments/:id/rollback").
  const tail = segments.at(-1) ?? "";
  const action = segments.length > 1 && !tail.startsWith(":") ? tail : verb;

  const id = input.params.id ?? input.params.appId;
  return {
    organizationId: input.ctx.organizationId,
    actorUserId: input.ctx.actor.userId ?? null,
    actorApiKeyId: input.ctx.actor.apiKeyId ?? null,
    action,
    resourceType,
    resourceId: typeof id === "string" ? id : null,
    metadata: { method: input.method, route: input.routeUrl, status: input.statusCode },
  };
}

/** Build a Database Studio audit event from request context. The query/edits
 *  routes record their own (with statement detail; writes only) because the
 *  generic mapper can't see the SQL — reads are deliberately not audited. */
export function dbStudioAuditEvent(
  ctx: RequestContext,
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>,
): AuditEvent | null {
  if (!ctx.organizationId) return null;
  return {
    organizationId: ctx.organizationId,
    actorUserId: ctx.actor.userId ?? null,
    actorApiKeyId: ctx.actor.apiKeyId ?? null,
    action,
    resourceType: "db-connections",
    resourceId,
    metadata,
  };
}

/** Insert the event; failures are swallowed (auditing never breaks a mutation). */
export async function recordAudit(db: Db, event: AuditEvent): Promise<void> {
  try {
    await db.insert(auditLog).values({ id: newId("aud"), ...event });
  } catch (err) {
    // best-effort by design, but a dropped audit row is compliance-relevant.
    swallow(`audit.insert:${event.action}`, err, "error");
  }
}

export interface AuditView {
  id: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export async function listAudit(db: Db, orgId: string, limit: number): Promise<AuditView[]> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.organizationId, orgId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    actorUserId: r.actorUserId,
    action: r.action,
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    metadata: r.metadata,
    createdAt: r.createdAt.toISOString(),
  }));
}
