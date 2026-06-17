import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getTemplateCompose, listCatalog, loadCatalog } from "../catalog/templates.js";
import { Problem } from "../schemas/common.js";

// One-click catalog (17-catalog-accessories.md) over the vendored Coolify
// templates: list the index, fetch one template with its decoded compose.
// Deploy-from-template lands with the compose builder path.

const CatalogItem = T.Object({
  slug: T.String(),
  slogan: T.String(),
  category: T.Union([T.String(), T.Null()]),
  tags: T.Array(T.String()),
  port: T.Union([T.String(), T.Null()]),
  logo: T.Union([T.String(), T.Null()]),
  documentation: T.String(),
});

const CatalogDetail = T.Composite([CatalogItem, T.Object({ compose: T.String() })]);

const SlugParam = T.Object({ slug: T.String({ minLength: 1, maxLength: 128 }) });

export const catalogRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/catalog",
    {
      schema: { tags: ["catalog"], response: { 200: T.Array(CatalogItem) } },
      preHandler: app.requirePermission("app:read"),
    },
    async () => listCatalog(),
  );

  app.get(
    "/catalog/:slug",
    {
      schema: {
        tags: ["catalog"],
        params: SlugParam,
        response: { 200: CatalogDetail, 404: Problem },
      },
      preHandler: app.requirePermission("app:read"),
    },
    async (req, reply) => {
      const entry = loadCatalog().get(req.params.slug);
      const compose = getTemplateCompose(req.params.slug);
      if (!entry || compose === null) {
        reply.code(404);
        return {
          type: "about:blank",
          title: "Not Found",
          status: 404,
          code: "catalog.unknown_template",
        };
      }
      return {
        slug: entry.slug,
        slogan: entry.slogan,
        category: entry.category ?? null,
        tags: entry.tags,
        port: entry.port ?? null,
        logo: entry.logo ?? null,
        documentation: entry.documentation,
        compose,
      };
    },
  );
};
