import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as envService from "../services/env.service.js";

// Masked view: secret values read back as null (never re-exposed).
const EnvVar = T.Object({
  key: T.String(),
  value: T.Union([T.String(), T.Null()]),
  isSecret: T.Boolean(),
});

const SetEnvBody = T.Object(
  {
    vars: T.Array(
      T.Object(
        {
          key: T.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$", maxLength: 256 }),
          value: T.String({ maxLength: 65536 }),
          isSecret: T.Optional(T.Boolean()),
        },
        { additionalProperties: false },
      ),
      { maxItems: 500 },
    ),
  },
  { additionalProperties: false },
);

const AppIdParam = T.Object({ appId: T.String() });

export const envRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/apps/:appId/env",
    {
      schema: {
        tags: ["env"],
        params: AppIdParam,
        response: { 200: T.Array(EnvVar), 404: Problem },
      },
      preHandler: app.requirePermission("env:read"),
    },
    async (req) => envService.listEnv(app.db, getOrgId(req), req.params.appId),
  );

  // PUT replaces the whole env set for the app.
  app.put(
    "/apps/:appId/env",
    {
      schema: {
        tags: ["env"],
        params: AppIdParam,
        body: SetEnvBody,
        response: { 200: T.Array(EnvVar), 400: Problem, 404: Problem },
      },
      preHandler: app.requirePermission("env:write"),
    },
    async (req) =>
      envService.setEnv(app.db, app.config, getOrgId(req), req.params.appId, req.body.vars),
  );
};
