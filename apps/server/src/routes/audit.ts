import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import * as auditService from "../services/audit.service.js";

// Org-scoped audit trail (05-auth-rbac.md). Owner/admin only via audit:read.

const AuditEvent = T.Object({
  id: T.String(),
  actorUserId: T.Union([T.String(), T.Null()]),
  action: T.String(),
  resourceType: T.String(),
  resourceId: T.Union([T.String(), T.Null()]),
  metadata: T.Union([T.Record(T.String(), T.Unknown()), T.Null()]),
  createdAt: T.String({ format: "date-time" }),
});

const ListQuery = T.Object({
  limit: T.Optional(T.Integer({ minimum: 1, maximum: 200, default: 50 })),
});

export const auditRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/audit",
    {
      schema: { tags: ["audit"], querystring: ListQuery, response: { 200: T.Array(AuditEvent) } },
      preHandler: app.requirePermission("audit:read"),
    },
    async (req) => auditService.listAudit(app.db, getOrgId(req), req.query.limit ?? 50),
  );
};
