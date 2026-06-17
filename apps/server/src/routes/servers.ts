import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import { ListQuery, Page, Problem } from "../schemas/common.js";
import * as metricsService from "../services/metrics.service.js";
import * as serversService from "../services/servers.service.js";

const Server = T.Object({
  id: T.String(),
  organizationId: T.String(),
  name: T.String(),
  host: T.String(),
  sshPort: T.Integer(),
  role: T.Union([T.Literal("control"), T.Literal("worker")]),
  status: T.Union([
    T.Literal("adding"),
    T.Literal("bootstrapping"),
    T.Literal("ready"),
    T.Literal("error"),
    T.Literal("unreachable"),
  ]),
  dockerOk: T.Boolean(),
  caddyOk: T.Boolean(),
  createdAt: T.String({ format: "date-time" }),
});

// The keypair is platform-generated; the public key is returned exactly once.
const CreatedServer = T.Composite([Server, T.Object({ publicKey: T.String() })]);

const CreateServer = T.Object(
  {
    name: T.String({ minLength: 1, maxLength: 100 }),
    host: T.String({ minLength: 1 }),
    sshPort: T.Optional(T.Integer({ minimum: 1, maximum: 65535 })),
    sshUser: T.Optional(T.String()),
  },
  { additionalProperties: false },
);

const UpdateServer = T.Partial(
  T.Object({ name: T.String({ minLength: 1 }), sshPort: T.Integer(), sshUser: T.String() }),
  { additionalProperties: false },
);

const IdParam = T.Object({ id: T.String() });

export const serversRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/servers",
    {
      schema: { tags: ["servers"], querystring: ListQuery, response: { 200: Page(Server) } },
      preHandler: app.requirePermission("server:read"),
    },
    async (req) =>
      serversService.listServers(app.db, getOrgId(req), {
        limit: req.query.limit ?? 25,
        ...(req.query.cursor ? { cursor: req.query.cursor } : {}),
      }),
  );

  app.post(
    "/servers",
    {
      schema: { tags: ["servers"], body: CreateServer, response: { 201: CreatedServer } },
      preHandler: app.requirePermission("server:write"),
    },
    async (req, reply) => {
      const created = await serversService.createServer(
        app.db,
        app.config,
        getOrgId(req),
        req.body,
      );
      reply.code(201);
      return created;
    },
  );

  app.get(
    "/servers/:id",
    {
      schema: { tags: ["servers"], params: IdParam, response: { 200: Server, 404: Problem } },
      preHandler: app.requirePermission("server:read"),
    },
    async (req) => serversService.getServer(app.db, getOrgId(req), req.params.id),
  );

  app.patch(
    "/servers/:id",
    {
      schema: {
        tags: ["servers"],
        params: IdParam,
        body: UpdateServer,
        response: { 200: Server, 404: Problem },
      },
      preHandler: app.requirePermission("server:write"),
    },
    async (req) => serversService.updateServer(app.db, getOrgId(req), req.params.id, req.body),
  );

  app.delete(
    "/servers/:id",
    {
      schema: { tags: ["servers"], params: IdParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("server:write"),
    },
    async (req, reply) => {
      await serversService.deleteServer(app.db, getOrgId(req), req.params.id);
      reply.code(204);
      return null;
    },
  );

  // (Re)generate the platform SSH keypair; install the returned public key in
  // the VM's authorized_keys before bootstrapping.
  app.post(
    "/servers/:id/key",
    {
      schema: {
        tags: ["servers"],
        params: IdParam,
        response: { 200: T.Object({ publicKey: T.String() }), 404: Problem },
      },
      preHandler: app.requirePermission("server:write"),
    },
    async (req) =>
      serversService.provisionServerKey(app.db, app.config, getOrgId(req), req.params.id),
  );

  // Agentless bootstrap (docker + compose via get.docker.com) — async: 202 and
  // the FSM flips bootstrapping → ready|error; poll GET /servers/:id.
  app.post(
    "/servers/:id/bootstrap",
    {
      schema: {
        tags: ["servers"],
        params: IdParam,
        response: {
          202: T.Object({ status: T.Literal("bootstrapping") }),
          400: Problem,
          404: Problem,
          409: Problem,
        },
      },
      preHandler: app.requirePermission("server:write"),
    },
    async (req, reply) => {
      const row = await serversService.startServerBootstrap(app.db, getOrgId(req), req.params.id);
      void serversService.runServerBootstrap(app.db, app.config, row);
      reply.code(202);
      return { status: "bootstrapping" as const };
    },
  );

  // Server metrics series (R1 tail). Use id="host" for control server metrics.
  app.get(
    "/servers/:id/metrics/series",
    {
      schema: {
        tags: ["metrics"],
        params: IdParam,
        querystring: T.Object({
          metric: T.Union([T.Literal("cpu"), T.Literal("mem"), T.Literal("disk")], {
            default: "cpu",
          }),
          range: T.Union([T.Literal("1h"), T.Literal("24h"), T.Literal("7d")], {
            default: "1h",
          }),
        }),
        response: {
          200: T.Object({
            metric: T.String(),
            range: T.String(),
            stepMs: T.Integer(),
            limitBytes: T.Union([T.Number(), T.Null()]),
            points: T.Array(
              T.Object({
                ts: T.Number(),
                avg: T.Number(),
                min: T.Number(),
                max: T.Number(),
                count: T.Integer(),
              }),
            ),
          }),
          404: Problem,
        },
      },
      preHandler: app.requirePermission("server:read"),
    },
    async (req) =>
      metricsService.serverSeries(
        app.db,
        getOrgId(req),
        req.params.id,
        req.query.metric,
        req.query.range,
      ),
  );

  const ServerCheckResult = T.Object({
    dockerOk: T.Boolean(),
    dockerVersion: T.Union([T.String(), T.Null()]),
    caddyOk: T.Boolean(),
    diskUsedPct: T.Union([T.Number(), T.Null()]),
    diskUsedBytes: T.Union([T.Number(), T.Null()]),
    diskTotalBytes: T.Union([T.Number(), T.Null()]),
    reachable: T.Boolean(),
    lastCheckedAt: T.String({ format: "date-time" }),
  });

  app.post(
    "/servers/:id/check",
    {
      schema: {
        tags: ["servers"],
        params: IdParam,
        response: { 200: ServerCheckResult, 404: Problem },
      },
      preHandler: app.requirePermission("server:write"),
    },
    async (req) => serversService.checkServer(app.db, app.config, getOrgId(req), req.params.id),
  );
};
