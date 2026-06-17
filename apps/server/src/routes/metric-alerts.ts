import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as metricsService from "../services/metrics.service.js";

// Threshold alerts (ROADMAP R1.3): when a target's windowed average crosses
// the threshold, the collector fires `server.threshold` through the signed
// outbound webhooks (channel fan-out is the documented tail).

const Alert = T.Object({
  id: T.String(),
  scope: T.Union([T.Literal("server"), T.Literal("app")]),
  targetId: T.String(),
  metric: T.String(),
  thresholdPct: T.Number(),
  windowSeconds: T.Integer(),
  enabled: T.Boolean(),
  lastFiredAt: T.Union([T.String({ format: "date-time" }), T.Null()]),
  createdAt: T.String({ format: "date-time" }),
});

const CreateAlert = T.Object(
  {
    scope: T.Union([T.Literal("server"), T.Literal("app")]),
    targetId: T.String({ minLength: 1, maxLength: 64 }),
    metric: T.Union([T.Literal("cpu"), T.Literal("mem")]),
    thresholdPct: T.Number({ minimum: 1, maximum: 100 }),
    windowSeconds: T.Optional(T.Integer({ minimum: 60, maximum: 86_400 })),
  },
  { additionalProperties: false },
);

const IdParam = T.Object({ id: T.String() });

export const metricAlertsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/metric-alerts",
    {
      schema: { tags: ["metrics"], response: { 200: T.Array(Alert) } },
      preHandler: app.requirePermission("app:read"),
    },
    async (req) => metricsService.listMetricAlerts(app.db, getOrgId(req)),
  );

  app.post(
    "/metric-alerts",
    {
      schema: {
        tags: ["metrics"],
        body: CreateAlert,
        response: { 201: Alert, 400: Problem },
      },
      preHandler: app.requirePermission("app:write"),
    },
    async (req, reply) => {
      const created = await metricsService.createMetricAlert(app.db, getOrgId(req), req.body);
      reply.code(201);
      return created;
    },
  );

  app.delete(
    "/metric-alerts/:id",
    {
      schema: { tags: ["metrics"], params: IdParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("app:write"),
    },
    async (req, reply) => {
      await metricsService.deleteMetricAlert(app.db, getOrgId(req), req.params.id);
      reply.code(204);
      return null;
    },
  );
};
