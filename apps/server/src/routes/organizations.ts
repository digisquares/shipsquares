import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";
import { NotFoundError, UnauthorizedError } from "@ss/shared";

import { rawSession } from "../auth/resolver.js";
import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as membersService from "../services/members.service.js";
import * as organizationsService from "../services/organizations.service.js";

const Organization = T.Object({
  id: T.String(),
  name: T.String(),
  slug: T.String(),
  createdAt: T.String({ format: "date-time" }),
});

const UpdateOrg = T.Partial(T.Object({ name: T.String({ minLength: 1, maxLength: 100 }) }), {
  additionalProperties: false,
});

const IdParam = T.Object({ id: T.String() });

// Read/rename the caller's own org. `:id` must be the session's active org (the
// switcher activates a different one) — a mismatch 404s rather than leaking that
// another org exists, mirroring the per-service tenant-isolation pattern. Org
// create/list-all/delete are intentionally not exposed (see organizations.service).
export const organizationsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/organizations/:id",
    {
      schema: {
        tags: ["organizations"],
        params: IdParam,
        response: { 200: Organization, 404: Problem },
      },
      preHandler: app.requirePermission("org:read"),
    },
    async (req) => {
      const orgId = getOrgId(req);
      if (req.params.id !== orgId) throw new NotFoundError("organization not found");
      return organizationsService.getOrganization(app.db, orgId);
    },
  );

  app.patch(
    "/organizations/:id",
    {
      schema: {
        tags: ["organizations"],
        params: IdParam,
        body: UpdateOrg,
        response: { 200: Organization, 404: Problem },
      },
      preHandler: app.requirePermission("org:write"),
    },
    async (req) => {
      const orgId = getOrgId(req);
      if (req.params.id !== orgId) throw new NotFoundError("organization not found");
      return organizationsService.updateOrganization(app.db, orgId, req.body);
    },
  );

  // ── Org switcher (R3.1) — session-authed, independent of the active org ───
  const MyOrg = T.Object({
    id: T.String(),
    name: T.String(),
    slug: T.String(),
    role: T.String(),
    active: T.Boolean(),
  });

  // Every org the current user belongs to (drives the switcher).
  app.get(
    "/me/organizations",
    { schema: { tags: ["organizations"], response: { 200: T.Array(MyOrg), 401: Problem } } },
    async (req) => {
      const session = await rawSession(app.auth, req);
      if (!session) throw new UnauthorizedError();
      const active = req.ctx?.organizationId ?? null;
      return membersService.listMyOrganizations(app.db, session.userId, active);
    },
  );

  // Switch the active org for this session (verifies membership).
  app.post(
    "/organizations/:id/activate",
    {
      schema: {
        tags: ["organizations"],
        params: IdParam,
        response: {
          200: T.Object({ activeOrganizationId: T.String() }),
          401: Problem,
          404: Problem,
        },
      },
    },
    async (req) => {
      const session = await rawSession(app.auth, req);
      if (!session) throw new UnauthorizedError();
      await membersService.setActiveOrg(app.db, session.userId, session.sessionId, req.params.id);
      return { activeOrganizationId: req.params.id };
    },
  );
};
