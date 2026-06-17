import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as notifications from "../services/notifications.service.js";

const Channel = T.Object({
  id: T.String(),
  kind: T.String(),
  name: T.String(),
  enabled: T.Boolean(),
  events: T.Array(T.String()),
  createdAt: T.String({ format: "date-time" }),
});

const EventName = T.Union([T.Literal("deploy.succeeded"), T.Literal("deploy.failed")]);

const CreateChannel = T.Object(
  {
    kind: T.Union([
      T.Literal("webhook"),
      T.Literal("slack"),
      T.Literal("discord"),
      T.Literal("telegram"),
      T.Literal("email"),
    ]),
    name: T.String({ minLength: 1, maxLength: 80 }),
    // Per-kind requirements are enforced by channelConfigFor (url kinds need a
    // url; telegram needs botToken+chatId; email needs to).
    url: T.Optional(T.String({ format: "uri", maxLength: 2048 })),
    botToken: T.Optional(T.String({ minLength: 1, maxLength: 256 })),
    chatId: T.Optional(T.String({ minLength: 1, maxLength: 64 })),
    to: T.Optional(T.String({ format: "email", maxLength: 254 })),
    events: T.Optional(T.Array(EventName, { minItems: 1 })),
  },
  { additionalProperties: false },
);

const IdParam = T.Object({ id: T.String() });

// Notification channels (30-notifications.md): org-scoped outbound channels that
// fire on deploy outcomes. Managing them reuses app:write (owner/admin/deployer),
// listing reuses app:read — they're org settings tied to the deploy workflow.
export const notificationsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/notification-channels",
    {
      schema: { tags: ["notifications"], response: { 200: T.Array(Channel) } },
      preHandler: app.requirePermission("app:read"),
    },
    async (req) => notifications.listChannels(app.db, getOrgId(req)),
  );

  app.post(
    "/notification-channels",
    {
      schema: {
        tags: ["notifications"],
        body: CreateChannel,
        response: { 201: Channel, 400: Problem },
      },
      preHandler: app.requirePermission("app:write"),
    },
    async (req, reply) => {
      const created = await notifications.createChannel(
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
    "/notification-channels/:id",
    {
      schema: {
        tags: ["notifications"],
        params: IdParam,
        response: { 204: T.Null(), 404: Problem },
      },
      preHandler: app.requirePermission("app:write"),
    },
    async (req, reply) => {
      await notifications.deleteChannel(app.db, getOrgId(req), req.params.id);
      reply.code(204);
      return null;
    },
  );

  app.post(
    "/notification-channels/:id/test",
    {
      schema: {
        tags: ["notifications"],
        params: IdParam,
        response: { 200: T.Object({ delivered: T.Boolean() }), 404: Problem },
      },
      preHandler: app.requirePermission("app:write"),
    },
    async (req) => notifications.testChannel(app.db, app.config, getOrgId(req), req.params.id),
  );
};
