import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as outboundService from "../services/outbound-webhooks.service.js";

// Outbound platform webhooks (10): org-scoped event subscriptions for machine
// consumers — signed deliveries, recorded attempts. The signing secret is
// write-only (sealed at rest, surfaced as hasSecret).

const Hook = T.Object({
  id: T.String(),
  url: T.String(),
  events: T.Array(T.String()),
  active: T.Boolean(),
  hasSecret: T.Boolean(),
  createdAt: T.String({ format: "date-time" }),
});

const CreateHook = T.Object(
  {
    url: T.String({ minLength: 1, maxLength: 2048 }),
    events: T.Array(T.String({ minLength: 1, maxLength: 64 }), { minItems: 1, maxItems: 16 }),
    secret: T.Optional(T.String({ minLength: 8, maxLength: 256 })),
  },
  { additionalProperties: false },
);

const Delivery = T.Object({
  deliveryId: T.String(),
  event: T.String(),
  status: T.String(),
  httpStatus: T.Union([T.Integer(), T.Null()]),
  error: T.Union([T.String(), T.Null()]),
  createdAt: T.String({ format: "date-time" }),
});

const IdParam = T.Object({ id: T.String() });

export const outboundWebhooksRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/outbound-webhooks",
    {
      schema: { tags: ["webhooks"], response: { 200: T.Array(Hook) } },
      preHandler: app.requirePermission("app:read"),
    },
    async (req) => outboundService.listOutboundWebhooks(app.db, getOrgId(req)),
  );

  app.post(
    "/outbound-webhooks",
    {
      schema: {
        tags: ["webhooks"],
        body: CreateHook,
        response: { 201: Hook, 400: Problem },
      },
      preHandler: app.requirePermission("app:write"),
    },
    async (req, reply) => {
      const created = await outboundService.createOutboundWebhook(
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
    "/outbound-webhooks/:id",
    {
      schema: { tags: ["webhooks"], params: IdParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("app:write"),
    },
    async (req, reply) => {
      await outboundService.deleteOutboundWebhook(app.db, getOrgId(req), req.params.id);
      reply.code(204);
      return null;
    },
  );

  // Delivery log: newest 50 attempts with status + endpoint answer.
  app.get(
    "/outbound-webhooks/:id/deliveries",
    {
      schema: {
        tags: ["webhooks"],
        params: IdParam,
        response: { 200: T.Array(Delivery), 404: Problem },
      },
      preHandler: app.requirePermission("app:read"),
    },
    async (req) => outboundService.listOutboundDeliveries(app.db, getOrgId(req), req.params.id),
  );
};
