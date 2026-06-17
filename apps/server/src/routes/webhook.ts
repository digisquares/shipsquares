import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";
import { NotFoundError } from "@ss/shared";

import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as webhooksService from "../services/webhooks.service.js";

const Provider = T.Union([
  T.Literal("github"),
  T.Literal("gitlab"),
  T.Literal("gitea"),
  T.Literal("bitbucket"),
]);

const Webhook = T.Object({
  id: T.String(),
  appId: T.String(),
  provider: Provider,
  url: T.String(),
  secret: T.Optional(T.String()), // present only on create/rotate
});

const AppIdParam = T.Object({ appId: T.String() });
const CreateWebhook = T.Object({ provider: T.Optional(Provider) }, { additionalProperties: false });

export const webhookRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Create or rotate the app's inbound webhook; the secret is shown once.
  app.post(
    "/apps/:appId/webhook",
    {
      schema: {
        tags: ["webhooks"],
        params: AppIdParam,
        body: CreateWebhook,
        response: { 201: Webhook, 404: Problem },
      },
      preHandler: app.requirePermission("webhook:write"),
    },
    async (req, reply) => {
      const created = await webhooksService.ensureWebhook(
        app.db,
        app.config,
        getOrgId(req),
        req.params.appId,
        req.body.provider ?? "github",
      );
      reply.code(201);
      return created;
    },
  );

  app.get(
    "/apps/:appId/webhook",
    {
      schema: { tags: ["webhooks"], params: AppIdParam, response: { 200: Webhook, 404: Problem } },
      preHandler: app.requirePermission("webhook:read"),
    },
    async (req) => {
      const wh = await webhooksService.getWebhook(
        app.db,
        app.config,
        getOrgId(req),
        req.params.appId,
      );
      if (!wh) throw new NotFoundError("no webhook configured for this app");
      return wh;
    },
  );
};
