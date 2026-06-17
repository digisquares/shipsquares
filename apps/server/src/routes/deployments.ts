import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { dispatchDeploy } from "../deploy/dispatch.js";
import { executeDeploy } from "../deploy/executor.js";
import { getCtx, getOrgId } from "../lib/ctx.js";
import { ListQuery, Page, Problem } from "../schemas/common.js";
import * as deploymentsService from "../services/deployments.service.js";

const DeployMeta = T.Object(
  {
    image: T.Optional(T.String()),
    container: T.Optional(T.String()),
    hostPort: T.Optional(T.String()),
    host: T.Optional(T.String()), // reachable host (worker IP for remote deploys, R4.1)
    containerPort: T.Optional(T.Integer()),
    url: T.Optional(T.String()),
  },
  { additionalProperties: false },
);

const Deployment = T.Object({
  id: T.String(),
  appId: T.String(),
  organizationId: T.String(),
  status: T.Union([
    T.Literal("queued"),
    T.Literal("running"),
    T.Literal("succeeded"),
    T.Literal("failed"),
    T.Literal("cancelled"),
  ]),
  trigger: T.Union([
    T.Literal("push"),
    T.Literal("manual"),
    T.Literal("api"),
    T.Literal("mcp"),
    T.Literal("schedule"),
    T.Literal("rollback"),
    T.Literal("preview"),
  ]),
  commitAfter: T.Union([T.String(), T.Null()]),
  errorMessage: T.Union([T.String(), T.Null()]),
  meta: T.Union([DeployMeta, T.Null()]),
  queuedAt: T.String({ format: "date-time" }),
  startedAt: T.Union([T.String({ format: "date-time" }), T.Null()]),
  finishedAt: T.Union([T.String({ format: "date-time" }), T.Null()]),
});

const LogLine = T.Object({
  seq: T.Integer(),
  stream: T.Union([T.Literal("stdout"), T.Literal("stderr"), T.Literal("system")]),
  line: T.String(),
  at: T.String({ format: "date-time" }),
});

const DeploymentStep = T.Object({
  id: T.String(),
  ordinal: T.Integer(),
  name: T.String(),
  status: T.String(),
  startedAt: T.Union([T.String({ format: "date-time" }), T.Null()]),
  finishedAt: T.Union([T.String({ format: "date-time" }), T.Null()]),
});

const AppIdParam = T.Object({ appId: T.String() });
const IdParam = T.Object({ id: T.String() });
const LogQuery = T.Object({
  sinceSeq: T.Optional(T.Integer({ minimum: 0 })),
  // Backward history paging: lines with seq < beforeSeq, newest window first.
  beforeSeq: T.Optional(T.Integer({ minimum: 1 })),
  limit: T.Optional(T.Integer({ minimum: 1, maximum: 1000 })),
});

export const deploymentsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Trigger a deploy. The pipeline runs in the background; the client polls the
  // deployment + its logs. 202 Accepted with the queued deployment.
  app.post(
    "/apps/:appId/deployments",
    {
      schema: {
        tags: ["deployments"],
        params: AppIdParam,
        response: { 202: Deployment, 404: Problem, 409: Problem },
      },
      preHandler: app.requirePermission("deployment:write"),
    },
    async (req, reply) => {
      const ctx = getCtx(req);
      const created = await deploymentsService.createDeployment(
        app.db,
        getOrgId(req),
        req.params.appId,
        {
          trigger: "manual",
          ...(ctx.actor.userId ? { triggeredBy: ctx.actor.userId } : {}),
        },
      );
      // Queue-backed (restart-survivable); inline fallback if the queue is down.
      await dispatchDeploy(app.queue, created.id, {}, () => {
        void executeDeploy(app.db, created.id).catch((err: unknown) => {
          app.log.error?.({ err, deploymentId: created.id }, "deploy failed");
        });
      });
      reply.code(202);
      return created;
    },
  );

  app.get(
    "/apps/:appId/deployments",
    {
      schema: {
        tags: ["deployments"],
        params: AppIdParam,
        querystring: ListQuery,
        response: { 200: Page(Deployment), 404: Problem },
      },
      preHandler: app.requirePermission("deployment:read"),
    },
    async (req) =>
      deploymentsService.listDeployments(app.db, getOrgId(req), req.params.appId, {
        limit: req.query.limit ?? 25,
        ...(req.query.cursor ? { cursor: req.query.cursor } : {}),
      }),
  );

  app.get(
    "/deployments/:id",
    {
      schema: {
        tags: ["deployments"],
        params: IdParam,
        response: { 200: Deployment, 404: Problem },
      },
      preHandler: app.requirePermission("deployment:read"),
    },
    async (req) => deploymentsService.getDeployment(app.db, getOrgId(req), req.params.id),
  );

  // Roll back to a previous succeeded deployment (re-runs its image, no rebuild).
  app.post(
    "/deployments/:id/rollback",
    {
      schema: {
        tags: ["deployments"],
        params: IdParam,
        response: { 202: Deployment, 400: Problem, 404: Problem, 409: Problem },
      },
      preHandler: app.requirePermission("deployment:write"),
    },
    async (req, reply) => {
      const { deployment, image } = await deploymentsService.rollbackDeployment(
        app.db,
        getOrgId(req),
        req.params.id,
      );
      await dispatchDeploy(app.queue, deployment.id, { image }, () => {
        void executeDeploy(app.db, deployment.id, { image }).catch((err: unknown) => {
          app.log.error?.({ err, deploymentId: deployment.id }, "rollback failed");
        });
      });
      reply.code(202);
      return deployment;
    },
  );

  // Cancel a queued deployment (running pipelines have no abort channel yet).
  app.post(
    "/deployments/:id/cancel",
    {
      schema: {
        tags: ["deployments"],
        params: IdParam,
        response: { 200: Deployment, 404: Problem, 409: Problem },
      },
      preHandler: app.requirePermission("deployment:write"),
    },
    async (req) => deploymentsService.cancelDeployment(app.db, getOrgId(req), req.params.id),
  );

  // Per-step pipeline progress (fetch|build|…) — drives the web deploy stepper.
  app.get(
    "/deployments/:id/steps",
    {
      schema: {
        tags: ["deployments"],
        params: IdParam,
        response: { 200: T.Array(DeploymentStep), 404: Problem },
      },
      preHandler: app.requirePermission("deployment:read"),
    },
    async (req) => deploymentsService.listDeploymentSteps(app.db, getOrgId(req), req.params.id),
  );

  app.get(
    "/deployments/:id/logs",
    {
      schema: {
        tags: ["deployments"],
        params: IdParam,
        querystring: LogQuery,
        response: { 200: T.Object({ lines: T.Array(LogLine) }), 404: Problem },
      },
      preHandler: app.requirePermission("deployment:read"),
    },
    async (req) =>
      deploymentsService.getDeploymentLogs(app.db, getOrgId(req), req.params.id, {
        ...(req.query.sinceSeq !== undefined ? { sinceSeq: req.query.sinceSeq } : {}),
        ...(req.query.beforeSeq !== undefined ? { beforeSeq: req.query.beforeSeq } : {}),
        ...(req.query.limit !== undefined ? { limit: req.query.limit } : {}),
      }),
  );
};
