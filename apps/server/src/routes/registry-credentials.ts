import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as registryService from "../services/registry-credentials.service.js";

// Private-registry pull credentials (06/11). The password is accepted once at
// create, sealed server-side, and never returned. apps.registryCredentialId
// selects which credential a deploy logs in with.

const View = T.Object({
  id: T.String(),
  registryUrl: T.String(),
  username: T.String(),
  createdAt: T.String({ format: "date-time" }),
});

const Create = T.Object(
  {
    registryUrl: T.String({ minLength: 1, maxLength: 255 }),
    username: T.String({ minLength: 1, maxLength: 255 }),
    password: T.String({ minLength: 1, maxLength: 4096 }),
  },
  { additionalProperties: false },
);

const IdParam = T.Object({ id: T.String() });

export const registryCredentialsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/registry-credentials",
    {
      schema: { tags: ["registries"], response: { 200: T.Array(View) } },
      preHandler: app.requirePermission("app:read"),
    },
    async (req) => registryService.listRegistryCredentials(app.db, getOrgId(req)),
  );

  app.post(
    "/registry-credentials",
    {
      schema: { tags: ["registries"], body: Create, response: { 201: View, 400: Problem } },
      preHandler: app.requirePermission("app:write"),
    },
    async (req, reply) => {
      const created = await registryService.createRegistryCredential(
        app.db,
        app.config,
        getOrgId(req),
        req.body,
      );
      reply.code(201);
      return created;
    },
  );

  app.delete(
    "/registry-credentials/:id",
    {
      schema: { tags: ["registries"], params: IdParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("app:write"),
    },
    async (req, reply) => {
      await registryService.deleteRegistryCredential(app.db, getOrgId(req), req.params.id);
      reply.code(204);
      return null;
    },
  );
};
