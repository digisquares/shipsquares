import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as databasesService from "../services/databases.service.js";

// Managed DB servers + provisioned databases (24-database-servers.md). Managed
// infra → server:read / server:write RBAC. The provision response carries the
// connection string EXACTLY ONCE (the password is sealed, never re-readable).

const ServerView = T.Object({
  id: T.String(),
  engine: T.String(),
  host: T.String(),
  port: T.Integer(),
  isDefault: T.Boolean(),
  tls: T.Boolean(),
  createdAt: T.String({ format: "date-time" }),
});

const RegisterServer = T.Object(
  {
    host: T.String({ minLength: 1, maxLength: 253 }),
    port: T.Optional(T.Integer({ minimum: 1, maximum: 65535 })),
    adminUrl: T.String({ minLength: 1, maxLength: 2048 }),
    isDefault: T.Optional(T.Boolean()),
    tls: T.Optional(T.Boolean()),
  },
  { additionalProperties: false },
);

const DatabaseView = T.Object({
  id: T.String(),
  serverId: T.String(),
  name: T.String(),
  ownerRole: T.String(),
  appId: T.Union([T.String(), T.Null()]),
  createdAt: T.String({ format: "date-time" }),
});

const CreateDatabase = T.Object(
  {
    serverId: T.String(),
    name: T.String({ minLength: 1, maxLength: 50 }),
    appId: T.Optional(T.String()),
  },
  { additionalProperties: false },
);

const Provisioned = T.Object({ database: DatabaseView, connectionString: T.String() });

const IdParam = T.Object({ id: T.String() });

export const databasesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/database-servers",
    {
      schema: { tags: ["databases"], response: { 200: T.Array(ServerView) } },
      preHandler: app.requirePermission("server:read"),
    },
    async (req) => databasesService.listServers(app.db, getOrgId(req)),
  );

  app.post(
    "/database-servers",
    {
      schema: {
        tags: ["databases"],
        body: RegisterServer,
        response: { 201: ServerView, 400: Problem },
      },
      preHandler: app.requirePermission("server:write"),
    },
    async (req, reply) => {
      const created = await databasesService.registerServer(
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
    "/database-servers/:id",
    {
      schema: { tags: ["databases"], params: IdParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("server:write"),
    },
    async (req, reply) => {
      await databasesService.deleteServer(app.db, getOrgId(req), req.params.id);
      reply.code(204);
      return null;
    },
  );

  app.get(
    "/databases",
    {
      schema: { tags: ["databases"], response: { 200: T.Array(DatabaseView) } },
      preHandler: app.requirePermission("server:read"),
    },
    async (req) => databasesService.listDatabases(app.db, getOrgId(req)),
  );

  app.post(
    "/databases",
    {
      schema: {
        tags: ["databases"],
        body: CreateDatabase,
        response: { 201: Provisioned, 400: Problem, 404: Problem },
      },
      preHandler: app.requirePermission("server:write"),
    },
    async (req, reply) => {
      const result = await databasesService.createDatabase(
        app.db,
        app.config,
        getOrgId(req),
        req.body,
      );
      reply.code(201);
      return result;
    },
  );

  app.delete(
    "/databases/:id",
    {
      schema: { tags: ["databases"], params: IdParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("server:write"),
    },
    async (req, reply) => {
      await databasesService.dropDatabase(app.db, app.config, getOrgId(req), req.params.id);
      reply.code(204);
      return null;
    },
  );
};
