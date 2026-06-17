import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";
import { UnauthorizedError } from "@ss/shared";

import { rawSession } from "../auth/resolver.js";
import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as invitesService from "../services/invites.service.js";
import * as membersService from "../services/members.service.js";

// Org members (04/05): list / change role / remove, plus invites (R3.4) and
// the org switcher (R3.1). The tested guards add the owner-specific invariants
// on top of member:read / member:write.

const Role = T.Union([
  T.Literal("owner"),
  T.Literal("admin"),
  T.Literal("deployer"),
  T.Literal("viewer"),
]);

const Member = T.Object({
  id: T.String(),
  userId: T.String(),
  email: T.Union([T.String(), T.Null()]),
  name: T.Union([T.String(), T.Null()]),
  role: T.String(),
  createdAt: T.String({ format: "date-time" }),
});

const RoleBody = T.Object({ role: Role }, { additionalProperties: false });

const Invite = T.Object({
  id: T.String(),
  email: T.String(),
  role: T.String(),
  status: T.String(),
  expiresAt: T.String({ format: "date-time" }),
  createdAt: T.String({ format: "date-time" }),
});

const IdParam = T.Object({ id: T.String() });

export const membersRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/members",
    {
      schema: { tags: ["members"], response: { 200: T.Array(Member) } },
      preHandler: app.requirePermission("member:read"),
    },
    async (req) => membersService.listMembers(app.db, getOrgId(req)),
  );

  app.patch(
    "/members/:id",
    {
      schema: {
        tags: ["members"],
        params: IdParam,
        body: RoleBody,
        response: { 200: Member, 403: Problem, 404: Problem, 409: Problem },
      },
      preHandler: app.requirePermission("member:write"),
    },
    async (req) => {
      const role = req.ctx?.role;
      if (!role) throw new UnauthorizedError();
      return membersService.changeMemberRole(
        app.db,
        getOrgId(req),
        role,
        req.params.id,
        req.body.role,
      );
    },
  );

  app.delete(
    "/members/:id",
    {
      schema: {
        tags: ["members"],
        params: IdParam,
        response: { 204: T.Null(), 403: Problem, 404: Problem, 409: Problem },
      },
      preHandler: app.requirePermission("member:write"),
    },
    async (req, reply) => {
      const role = req.ctx?.role;
      if (!role) throw new UnauthorizedError();
      await membersService.removeMember(app.db, getOrgId(req), role, req.params.id);
      reply.code(204);
      return null;
    },
  );

  // ── Invites (R3.4) ────────────────────────────────────────────────────────
  app.get(
    "/members/invites",
    {
      schema: { tags: ["members"], response: { 200: T.Array(Invite) } },
      preHandler: app.requirePermission("member:read"),
    },
    async (req) => invitesService.listInvites(app.db, getOrgId(req)),
  );

  app.post(
    "/members/invites",
    {
      schema: {
        tags: ["members"],
        body: T.Object(
          { email: T.String({ minLength: 3, maxLength: 254 }), role: Role },
          { additionalProperties: false },
        ),
        response: {
          201: T.Composite([Invite, T.Object({ acceptUrl: T.String(), emailed: T.Boolean() })]),
          400: Problem,
          403: Problem,
        },
      },
      preHandler: app.requirePermission("member:write"),
    },
    async (req, reply) => {
      const role = req.ctx?.role;
      if (!role) throw new UnauthorizedError();
      const created = await invitesService.createInvite(
        app.db,
        app.config,
        getOrgId(req),
        role,
        req.ctx?.actor.userId,
        req.body,
      );
      reply.code(201);
      return created;
    },
  );

  app.delete(
    "/members/invites/:id",
    {
      schema: { tags: ["members"], params: IdParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("member:write"),
    },
    async (req, reply) => {
      await invitesService.revokeInvite(app.db, getOrgId(req), req.params.id);
      reply.code(204);
      return null;
    },
  );

  // Accept: authenticated but NOT org-scoped (a new user has no membership
  // yet), so it does its own session check instead of requirePermission.
  app.post(
    "/members/invites/accept",
    {
      schema: {
        tags: ["members"],
        body: T.Object({ token: T.String({ minLength: 16 }) }, { additionalProperties: false }),
        response: {
          200: T.Object({ organizationId: T.String(), role: T.String() }),
          401: Problem,
          403: Problem,
          404: Problem,
          409: Problem,
          410: Problem,
        },
      },
    },
    async (req) => {
      const session = await rawSession(app.auth, req);
      if (!session) throw new UnauthorizedError();
      return invitesService.acceptInvite(app.db, req.body.token, {
        userId: session.userId,
        email: session.email,
      });
    },
  );
};
