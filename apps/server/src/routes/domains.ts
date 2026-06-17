import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import { convergeProxy } from "../proxy/caddy/converge.js";
import { Problem } from "../schemas/common.js";
import * as domainsService from "../services/domains.service.js";

const Domain = T.Object({
  id: T.String(),
  appId: T.String(),
  fqdn: T.String(),
  https: T.Boolean(),
  certStatus: T.Union([
    T.Literal("pending"),
    T.Literal("issuing"),
    T.Literal("active"),
    T.Literal("failed"),
    T.Literal("disabled"),
  ]),
  isPrimary: T.Boolean(),
  createdAt: T.String({ format: "date-time" }),
});

const CreateDomain = T.Object(
  { fqdn: T.String({ minLength: 1, maxLength: 253 }), https: T.Optional(T.Boolean()) },
  { additionalProperties: false },
);

const AppIdParam = T.Object({ appId: T.String() });
const IdParam = T.Object({ id: T.String() });

export const domainsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Reconverge Caddy after a domain change so routes reflect the DB. Non-fatal:
  // a dev run without Caddy just skips it.
  const reconverge = () =>
    void convergeProxy(app.db, app.config).catch((err: unknown) => {
      app.log.warn?.({ err }, "caddy converge skipped");
    });

  app.post(
    "/apps/:appId/domains",
    {
      schema: {
        tags: ["domains"],
        params: AppIdParam,
        body: CreateDomain,
        response: { 201: Domain, 404: Problem, 409: Problem },
      },
      preHandler: app.requirePermission("domain:write"),
    },
    async (req, reply) => {
      const created = await domainsService.addDomain(
        app.db,
        getOrgId(req),
        req.params.appId,
        req.body,
      );
      reconverge();
      reply.code(201);
      return created;
    },
  );

  app.get(
    "/apps/:appId/domains",
    {
      schema: {
        tags: ["domains"],
        params: AppIdParam,
        response: { 200: T.Array(Domain), 404: Problem },
      },
      preHandler: app.requirePermission("domain:read"),
    },
    async (req) => domainsService.listDomains(app.db, getOrgId(req), req.params.appId),
  );

  app.delete(
    "/domains/:id",
    {
      schema: { tags: ["domains"], params: IdParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("domain:write"),
    },
    async (req, reply) => {
      await domainsService.removeDomain(app.db, getOrgId(req), req.params.id);
      reconverge();
      reply.code(204);
      return null;
    },
  );
};
