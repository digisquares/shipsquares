import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as apiKeysService from "../services/api-keys.service.js";

// API keys (05): the token appears ONLY in the create response. apikey:* is
// owner/admin per the role matrix — keys cannot mint keys (they act as deployer).

const View = T.Object({
  id: T.String(),
  name: T.String(),
  scopes: T.Array(T.String()),
  lastUsedAt: T.Union([T.String({ format: "date-time" }), T.Null()]),
  expiresAt: T.Union([T.String({ format: "date-time" }), T.Null()]),
  revokedAt: T.Union([T.String({ format: "date-time" }), T.Null()]),
  createdAt: T.String({ format: "date-time" }),
});

const Create = T.Object(
  {
    name: T.String({ minLength: 1, maxLength: 120 }),
    scopes: T.Optional(T.Array(T.String({ maxLength: 64 }), { maxItems: 32 })),
    expiresAt: T.Optional(T.String({ format: "date-time" })),
  },
  { additionalProperties: false },
);

const Created = T.Object({ key: View, token: T.String() });

const IdParam = T.Object({ id: T.String() });

export const apiKeysRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/api-keys",
    {
      schema: { tags: ["api-keys"], response: { 200: T.Array(View) } },
      preHandler: app.requirePermission("apikey:read"),
    },
    async (req) => apiKeysService.listApiKeys(app.db, getOrgId(req)),
  );

  app.post(
    "/api-keys",
    {
      schema: { tags: ["api-keys"], body: Create, response: { 201: Created, 400: Problem } },
      preHandler: app.requirePermission("apikey:write"),
    },
    async (req, reply) => {
      const created = await apiKeysService.createApiKey(
        app.db,
        getOrgId(req),
        req.ctx?.actor.userId,
        req.body,
      );
      reply.code(201);
      return created;
    },
  );

  app.post(
    "/api-keys/:id/revoke",
    {
      schema: { tags: ["api-keys"], params: IdParam, response: { 200: View, 404: Problem } },
      preHandler: app.requirePermission("apikey:write"),
    },
    async (req) => apiKeysService.revokeApiKey(app.db, getOrgId(req), req.params.id),
  );

  app.delete(
    "/api-keys/:id",
    {
      schema: { tags: ["api-keys"], params: IdParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("apikey:write"),
    },
    async (req, reply) => {
      await apiKeysService.deleteApiKey(app.db, getOrgId(req), req.params.id);
      reply.code(204);
      return null;
    },
  );
};
