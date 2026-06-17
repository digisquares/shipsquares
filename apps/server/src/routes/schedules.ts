import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as schedulesService from "../services/schedules.service.js";

// Scheduled jobs (29-scheduled-jobs.md): cron commands against an app container
// (or the host). Managing reuses app:write, listing app:read — they act on the
// org's apps/servers. Cron/shell/target are validated by the service.

const Schedule = T.Object({
  id: T.String(),
  name: T.String(),
  target: T.Union([T.Literal("app_container"), T.Literal("service"), T.Literal("server")]),
  appId: T.Union([T.String(), T.Null()]),
  serverId: T.Union([T.String(), T.Null()]),
  command: T.String(),
  shell: T.String(),
  cron: T.String(),
  timezone: T.String(),
  enabled: T.Boolean(),
  createdAt: T.String({ format: "date-time" }),
});

const CreateSchedule = T.Object(
  {
    name: T.String({ minLength: 1, maxLength: 80 }),
    target: T.Union([T.Literal("app_container"), T.Literal("service"), T.Literal("server")]),
    appId: T.Optional(T.String()),
    serverId: T.Optional(T.String()),
    command: T.String({ minLength: 1, maxLength: 4096 }),
    shell: T.Optional(T.Union([T.Literal("bash"), T.Literal("sh")])),
    cron: T.String({ minLength: 9, maxLength: 64 }),
    timezone: T.Optional(T.String({ maxLength: 64 })),
  },
  { additionalProperties: false },
);

const ScheduleRun = T.Object({
  id: T.String(),
  status: T.String(),
  exitCode: T.Union([T.Integer(), T.Null()]),
  outputTail: T.Union([T.String(), T.Null()]),
  error: T.Union([T.String(), T.Null()]),
  startedAt: T.String({ format: "date-time" }),
  finishedAt: T.Union([T.String({ format: "date-time" }), T.Null()]),
});

const IdParam = T.Object({ id: T.String() });

export const schedulesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/schedules",
    {
      schema: { tags: ["schedules"], response: { 200: T.Array(Schedule) } },
      preHandler: app.requirePermission("app:read"),
    },
    async (req) => schedulesService.listSchedules(app.db, getOrgId(req)),
  );

  app.post(
    "/schedules",
    {
      schema: {
        tags: ["schedules"],
        body: CreateSchedule,
        response: { 201: Schedule, 400: Problem },
      },
      preHandler: app.requirePermission("app:write"),
    },
    async (req, reply) => {
      const orgId = getOrgId(req);
      const created = await schedulesService.createSchedule(app.db, orgId, req.body);
      // Register cron + worker; non-fatal if the queue isn't running (dev).
      try {
        const row = await schedulesService.getScheduleRow(app.db, orgId, created.id);
        await schedulesService.syncSchedule(app.db, app.queue, row);
      } catch (err) {
        app.log.warn?.({ err }, "schedule cron registration skipped");
      }
      reply.code(201);
      return created;
    },
  );

  app.delete(
    "/schedules/:id",
    {
      schema: { tags: ["schedules"], params: IdParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("app:write"),
    },
    async (req, reply) => {
      await schedulesService.deleteSchedule(app.db, app.queue, getOrgId(req), req.params.id);
      reply.code(204);
      return null;
    },
  );

  // Run history: newest 50, with the clamped output tail per run.
  app.get(
    "/schedules/:id/runs",
    {
      schema: {
        tags: ["schedules"],
        params: IdParam,
        response: { 200: T.Array(ScheduleRun), 404: Problem },
      },
      preHandler: app.requirePermission("app:read"),
    },
    async (req) => schedulesService.listScheduleRuns(app.db, getOrgId(req), req.params.id),
  );

  // Run-now: fire the job immediately (the run lands in scheduled_job_runs).
  app.post(
    "/schedules/:id/run",
    {
      schema: {
        tags: ["schedules"],
        params: IdParam,
        response: { 202: T.Object({ started: T.Boolean() }), 404: Problem },
      },
      preHandler: app.requirePermission("app:write"),
    },
    async (req, reply) => {
      const row = await schedulesService.getScheduleRow(app.db, getOrgId(req), req.params.id);
      void schedulesService.runScheduleNow(app.db, row);
      reply.code(202);
      return { started: true };
    },
  );
};
