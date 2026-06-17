import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as replicationService from "../services/replication.service.js";

// DB replication (ROADMAP R5.1): logical publication/subscription mirrors for
// the managed PG (24). server:write — managed infra. Runs SQL over the admin
// connections; streaming/base-backup is operator-driven (rejected at create).

const Replica = T.Object({
  id: T.String(),
  primaryServerId: T.String(),
  replicaServerId: T.Union([T.String(), T.Null()]),
  mode: T.String(),
  status: T.String(),
  slotName: T.Union([T.String(), T.Null()]),
  createdAt: T.String({ format: "date-time" }),
});

const CreateReplica = T.Object(
  {
    primaryServerId: T.String(),
    replicaServerId: T.String(),
    mode: T.Optional(T.Union([T.Literal("logical"), T.Literal("streaming")])),
  },
  { additionalProperties: false },
);

const IdParam = T.Object({ id: T.String() });

export const replicasRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/db-replicas",
    {
      schema: { tags: ["replication"], response: { 200: T.Array(Replica) } },
      preHandler: app.requirePermission("server:read"),
    },
    async (req) => replicationService.listReplicas(app.db, getOrgId(req)),
  );

  app.post(
    "/db-replicas",
    {
      schema: {
        tags: ["replication"],
        body: CreateReplica,
        response: { 201: Replica, 400: Problem },
      },
      preHandler: app.requirePermission("server:write"),
    },
    async (req, reply) => {
      const created = await replicationService.createReplica(
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
    "/db-replicas/:id",
    {
      schema: { tags: ["replication"], params: IdParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("server:write"),
    },
    async (req, reply) => {
      await replicationService.deleteReplica(app.db, app.config, getOrgId(req), req.params.id);
      reply.code(204);
      return null;
    },
  );
};
