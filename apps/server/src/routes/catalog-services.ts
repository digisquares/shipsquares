import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as catalogServicesService from "../services/catalog-services.service.js";

// Installed catalog services (17): one-click compose stacks from the vendored
// templates. Installs are async — the row's status carries the outcome.

const View = T.Object({
  id: T.String(),
  slug: T.String(),
  name: T.String(),
  status: T.String(),
  error: T.Union([T.String(), T.Null()]),
  unsupportedTokens: T.Array(T.String()),
  createdAt: T.String({ format: "date-time" }),
});

const Install = T.Object(
  {
    slug: T.String({ minLength: 1, maxLength: 128 }),
    name: T.Optional(T.String({ minLength: 1, maxLength: 120 })),
  },
  { additionalProperties: false },
);

const IdParam = T.Object({ id: T.String() });

export const catalogServicesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/catalog-services",
    {
      schema: { tags: ["catalog"], response: { 200: T.Array(View) } },
      preHandler: app.requirePermission("server:read"),
    },
    async (req) => catalogServicesService.listCatalogServices(app.db, getOrgId(req)),
  );

  app.post(
    "/catalog-services",
    {
      schema: {
        tags: ["catalog"],
        body: Install,
        response: { 202: View, 400: Problem, 404: Problem },
      },
      preHandler: app.requirePermission("server:write"),
    },
    async (req, reply) => {
      const created = await catalogServicesService.installCatalogService(
        app.db,
        getOrgId(req),
        req.body,
      );
      reply.code(202); // install continues in the background
      return created;
    },
  );

  app.delete(
    "/catalog-services/:id",
    {
      schema: { tags: ["catalog"], params: IdParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("server:write"),
    },
    async (req, reply) => {
      await catalogServicesService.uninstallCatalogService(app.db, getOrgId(req), req.params.id);
      reply.code(204);
      return null;
    },
  );
};
