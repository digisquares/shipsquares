import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";
import { ConflictError } from "@ss/shared";

import { removeAppContainers, removeAppProject } from "../deploy/executor.js";
import { refreshAppRoute, startApp, stopApp, restartApp } from "../deploy/lifecycle.js";
import { tailLogs } from "../deploy/logs.js";
import { appMetrics } from "../deploy/metrics.js";
import { getOrgId } from "../lib/ctx.js";
import { convergeProxy } from "../proxy/caddy/converge.js";
import { ListQuery, Page, Problem } from "../schemas/common.js";
import * as appsService from "../services/apps.service.js";
import * as metricsService from "../services/metrics.service.js";

const App = T.Object({
  id: T.String(),
  organizationId: T.String(),
  name: T.String(),
  repo: T.Union([T.String(), T.Null()]),
  image: T.Union([T.String(), T.Null()]),
  branch: T.String(),
  port: T.Integer(),
  cpu: T.Union([T.Number(), T.Null()]),
  memoryMb: T.Union([T.Integer(), T.Null()]),
  buildStrategy: T.Union([
    T.Literal("compose"),
    T.Literal("dockerfile"),
    T.Literal("nixpacks"),
    T.Literal("buildpacks"),
    T.Literal("static"),
  ]),
  buildConfig: T.Object({
    rootDirectory: T.Union([T.String(), T.Null()]),
    dockerfilePath: T.Union([T.String(), T.Null()]),
    publishDirectory: T.Union([T.String(), T.Null()]),
    builder: T.Union([T.String(), T.Null()]),
  }),
  vcsConnectionId: T.Union([T.String(), T.Null()]),
  gitPollEnabled: T.Boolean(),
  previewEnabled: T.Boolean(),
  previewWildcardDomain: T.Union([T.String(), T.Null()]),
  previewLimit: T.Integer(),
  registryCredentialId: T.Union([T.String(), T.Null()]),
  preDeployCommand: T.Union([T.String(), T.Null()]),
  postDeployCommand: T.Union([T.String(), T.Null()]),
  createdAt: T.String({ format: "date-time" }),
});

const Cpu = T.Number({ minimum: 0.1, maximum: 64 });
const MemoryMb = T.Integer({ minimum: 6, maximum: 524288 });
const BuildStrategy = T.Union([
  T.Literal("compose"),
  T.Literal("dockerfile"),
  T.Literal("nixpacks"),
  T.Literal("buildpacks"),
  T.Literal("static"),
]);
const BuildConfigBody = T.Object(
  {
    rootDirectory: T.Optional(T.String({ maxLength: 255 })),
    dockerfilePath: T.Optional(T.String({ maxLength: 255 })),
    publishDirectory: T.Optional(T.String({ maxLength: 255 })),
    builder: T.Optional(T.String({ maxLength: 255 })),
  },
  { additionalProperties: false },
);

const CreateApp = T.Object(
  {
    name: T.String({ minLength: 1, maxLength: 63 }),
    repo: T.Optional(T.String({ format: "uri" })),
    image: T.Optional(T.String({ minLength: 1, maxLength: 255 })),
    branch: T.Optional(T.String()),
    port: T.Optional(T.Integer({ minimum: 1, maximum: 65535 })),
    cpu: T.Optional(Cpu),
    memoryMb: T.Optional(MemoryMb),
    serverId: T.Optional(T.String()),
    vcsConnectionId: T.Optional(T.String()),
    buildStrategy: T.Optional(BuildStrategy),
    buildConfig: T.Optional(BuildConfigBody),
  },
  { additionalProperties: false },
);

const UpdateApp = T.Partial(
  T.Object({
    name: T.String({ minLength: 1, maxLength: 63 }),
    repo: T.Union([T.String({ format: "uri" }), T.Null()]),
    image: T.Union([T.String({ minLength: 1, maxLength: 255 }), T.Null()]),
    branch: T.String(),
    port: T.Integer({ minimum: 1, maximum: 65535 }),
    cpu: T.Union([Cpu, T.Null()]),
    memoryMb: T.Union([MemoryMb, T.Null()]),
    serverId: T.Union([T.String(), T.Null()]),
    vcsConnectionId: T.Union([T.String(), T.Null()]),
    buildStrategy: BuildStrategy,
    buildConfig: BuildConfigBody,
    gitPollEnabled: T.Boolean(),
    previewEnabled: T.Boolean(),
    previewWildcardDomain: T.Union([T.String({ maxLength: 253 }), T.Null()]),
    previewLimit: T.Integer({ minimum: 1, maximum: 50 }),
    registryCredentialId: T.Union([T.String(), T.Null()]),
    preDeployCommand: T.Union([T.String({ maxLength: 4096 }), T.Null()]),
    postDeployCommand: T.Union([T.String({ maxLength: 4096 }), T.Null()]),
  }),
  { additionalProperties: false },
);

const IdParam = T.Object({ id: T.String() });

const Metrics = T.Object({
  running: T.Boolean(),
  cpuPercent: T.Optional(T.Number()),
  memPercent: T.Optional(T.Number()),
  memUsage: T.Optional(T.String()),
});

const RuntimeLog = T.Object({
  stream: T.String(),
  line: T.String(),
  ts: T.Optional(T.String()),
});
const LogsQuery = T.Object({ tail: T.Optional(T.Integer({ minimum: 1, maximum: 2000 })) });

// Org-scoped, tenant-isolated (05-auth-rbac.md): the org always comes from the
// authenticated context, never the body.
export const appsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/apps",
    {
      schema: { tags: ["apps"], querystring: ListQuery, response: { 200: Page(App) } },
      preHandler: app.requirePermission("app:read"),
    },
    async (req) =>
      appsService.listApps(app.db, getOrgId(req), {
        limit: req.query.limit ?? 25,
        ...(req.query.cursor ? { cursor: req.query.cursor } : {}),
      }),
  );

  app.post(
    "/apps",
    {
      schema: { tags: ["apps"], body: CreateApp, response: { 201: App, 409: Problem } },
      preHandler: app.requirePermission("app:write"),
    },
    async (req, reply) => {
      const created = await appsService.createApp(app.db, getOrgId(req), req.body);
      reply.code(201);
      return created;
    },
  );

  app.get(
    "/apps/:id",
    {
      schema: { tags: ["apps"], params: IdParam, response: { 200: App, 404: Problem } },
      preHandler: app.requirePermission("app:read"),
    },
    async (req) => appsService.getApp(app.db, getOrgId(req), req.params.id),
  );

  app.patch(
    "/apps/:id",
    {
      schema: {
        tags: ["apps"],
        params: IdParam,
        body: UpdateApp,
        response: { 200: App, 404: Problem },
      },
      preHandler: app.requirePermission("app:write"),
    },
    async (req) => appsService.updateApp(app.db, getOrgId(req), req.params.id, req.body),
  );

  app.delete(
    "/apps/:id",
    {
      schema: { tags: ["apps"], params: IdParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("app:write"),
    },
    async (req, reply) => {
      const appId = req.params.id;
      await appsService.deleteApp(app.db, getOrgId(req), appId);
      // Best-effort teardown: remove the app's single-run containers (by
      // label), its compose project if it deployed as one, and drop its Caddy
      // route (the app's domains were cascade-deleted).
      void removeAppContainers(appId).catch((err: unknown) =>
        app.log.warn?.({ err, appId }, "app teardown incomplete: containers"),
      );
      void removeAppProject(appId).catch((err: unknown) =>
        app.log.warn?.({ err, appId }, "app teardown incomplete: compose project"),
      );
      void convergeProxy(app.db, app.config).catch((err: unknown) =>
        app.log.warn?.({ err, appId }, "app teardown incomplete: proxy converge"),
      );
      reply.code(204);
      return null;
    },
  );

  // Historical time-series (bucketed) — drives the charts (ROADMAP R1.2).
  app.get(
    "/apps/:id/metrics/series",
    {
      schema: {
        tags: ["metrics"],
        params: IdParam,
        querystring: T.Object({
          metric: T.Union([T.Literal("cpu"), T.Literal("mem")], { default: "cpu" }),
          range: T.Union([T.Literal("1h"), T.Literal("24h"), T.Literal("7d")], {
            default: "1h",
          }),
        }),
        response: {
          200: T.Object({
            metric: T.String(),
            range: T.String(),
            stepMs: T.Integer(),
            memLimitBytes: T.Union([T.Number(), T.Null()]),
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
      preHandler: app.requirePermission("app:read"),
    },
    async (req) =>
      metricsService.appSeries(
        app.db,
        getOrgId(req),
        req.params.id,
        req.query.metric,
        req.query.range,
      ),
  );

  // Live container resource usage (CPU/mem) for the app's running container.
  app.get(
    "/apps/:id/metrics",
    {
      schema: { tags: ["apps"], params: IdParam, response: { 200: Metrics, 404: Problem } },
      preHandler: app.requirePermission("app:read"),
    },
    async (req) => {
      await appsService.getApp(app.db, getOrgId(req), req.params.id); // 404 if cross-tenant
      return appMetrics(req.params.id);
    },
  );

  // Runtime container logs (stdout/stderr) — a point-in-time tail. The live
  // stream is the WS `app:<id>` topic; this is the REST snapshot for CLI/MCP/etc.
  app.get(
    "/apps/:id/logs",
    {
      schema: {
        tags: ["apps"],
        params: IdParam,
        querystring: LogsQuery,
        response: { 200: T.Object({ lines: T.Array(RuntimeLog) }), 404: Problem },
      },
      preHandler: app.requirePermission("app:read"),
    },
    async (req) => {
      await appsService.getApp(app.db, getOrgId(req), req.params.id); // 404 if cross-tenant
      return { lines: await tailLogs(req.params.id, req.query.tail ?? 200) };
    },
  );

  // Lifecycle: stop / start / restart the running container(s) with NO rebuild
  // (06-deploy-engine.md). Each returns the resulting live metrics so the UI
  // refreshes its running/stopped state immediately. `getApp` first → 404 on a
  // cross-tenant id. `start` 409s when the app has no container to start.
  app.post(
    "/apps/:id/stop",
    {
      schema: { tags: ["apps"], params: IdParam, response: { 200: Metrics, 404: Problem } },
      preHandler: app.requirePermission("app:write"),
    },
    async (req) => {
      await appsService.getApp(app.db, getOrgId(req), req.params.id);
      await stopApp(req.params.id);
      return appMetrics(req.params.id);
    },
  );

  app.post(
    "/apps/:id/restart",
    {
      schema: { tags: ["apps"], params: IdParam, response: { 200: Metrics, 404: Problem } },
      preHandler: app.requirePermission("app:write"),
    },
    async (req) => {
      await appsService.getApp(app.db, getOrgId(req), req.params.id);
      await restartApp(req.params.id);
      // restart re-allocates the ephemeral host port → refresh the Caddy route.
      await refreshAppRoute(app.db, app.config, req.params.id);
      return appMetrics(req.params.id);
    },
  );

  app.post(
    "/apps/:id/start",
    {
      schema: {
        tags: ["apps"],
        params: IdParam,
        response: { 200: Metrics, 404: Problem, 409: Problem },
      },
      preHandler: app.requirePermission("app:write"),
    },
    async (req) => {
      await appsService.getApp(app.db, getOrgId(req), req.params.id);
      if (!(await startApp(req.params.id)))
        throw new ConflictError("no container to start — deploy the app first");
      // start re-allocates the ephemeral host port → refresh the Caddy route.
      await refreshAppRoute(app.db, app.config, req.params.id);
      return appMetrics(req.params.id);
    },
  );
};
