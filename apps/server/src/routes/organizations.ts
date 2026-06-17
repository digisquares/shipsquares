import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";
import { AppError, UnauthorizedError } from "@ss/shared";

import { rawSession } from "../auth/resolver.js";
import { ListQuery, Page, Problem } from "../schemas/common.js";
import * as membersService from "../services/members.service.js";

const Organization = T.Object({
  id: T.String(),
  name: T.String(),
  slug: T.String(),
  createdAt: T.String({ format: "date-time" }),
});

const CreateOrg = T.Object(
  {
    name: T.String({ minLength: 1, maxLength: 100 }),
    slug: T.String({ minLength: 1, maxLength: 63, pattern: "^[a-z0-9-]+$" }),
  },
  { additionalProperties: false },
);

const UpdateOrg = T.Partial(T.Object({ name: T.String({ minLength: 1, maxLength: 100 }) }), {
  additionalProperties: false,
});

const IdParam = T.Object({ id: T.String() });

function notImplemented(): never {
  throw new AppError("not implemented", { status: 501, code: "not_implemented" });
}

export const organizationsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/organizations",
    {
      schema: {
        tags: ["organizations"],
        querystring: ListQuery,
        response: { 200: Page(Organization) },
      },
      preHandler: app.requirePermission("org:read"),
    },
    notImplemented,
  );

  app.post(
    "/organizations",
    {
      schema: {
        tags: ["organizations"],
        body: CreateOrg,
        response: { 201: Organization, 409: Problem },
      },
      preHandler: app.requirePermission("org:write"),
    },
    notImplemented,
  );

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
    notImplemented,
  );

  app.patch(
    "/organizations/:id",
    {
      schema: {
        tags: ["organizations"],
        params: IdParam,
        body: UpdateOrg,
        response: { 200: Organization },
      },
      preHandler: app.requirePermission("org:write"),
    },
    notImplemented,
  );

  app.delete(
    "/organizations/:id",
    {
      schema: { tags: ["organizations"], params: IdParam, response: { 204: T.Null() } },
      // Deliberately org:delete (owner-only in the matrix) — org:write would hand
      // deletion to admins the moment this is implemented.
      preHandler: app.requirePermission("org:delete"),
    },
    notImplemented,
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
