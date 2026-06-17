import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as appsService from "../services/apps.service.js";
import * as previewsService from "../services/previews.service.js";

// Preview environments per app (31): the rows the PR webhook maintains.

const Preview = T.Object({
  id: T.String(),
  prNumber: T.Integer(),
  prTitle: T.Union([T.String(), T.Null()]),
  branch: T.String(),
  status: T.String(),
  domain: T.Union([T.String(), T.Null()]),
  createdAt: T.String({ format: "date-time" }),
  closedAt: T.Union([T.String({ format: "date-time" }), T.Null()]),
});

const AppIdParam = T.Object({ appId: T.String() });

export const previewsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/apps/:appId/previews",
    {
      schema: {
        tags: ["previews"],
        params: AppIdParam,
        response: { 200: T.Array(Preview), 404: Problem },
      },
      preHandler: app.requirePermission("app:read"),
    },
    async (req) => {
      await appsService.getApp(app.db, getOrgId(req), req.params.appId); // 404 if cross-tenant
      return previewsService.listPreviews(app.db, req.params.appId);
    },
  );
};
