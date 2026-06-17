import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as backupsService from "../services/backups.service.js";

// Scheduled DB backups (27 over the 24 provisioning rows). Managed infra →
// server:read / server:write. Destination credentials are sealed at rest and
// never returned.

const ConfigView = T.Object({
  id: T.String(),
  serverId: T.String(),
  databaseId: T.Union([T.String(), T.Null()]),
  type: T.String(),
  schedule: T.String(),
  walArchive: T.Boolean(),
  walSchedule: T.Union([T.String(), T.Null()]),
  keepNewest: T.Integer(),
  retentionDays: T.Integer(),
  enabled: T.Boolean(),
  lastWalAt: T.Union([T.String({ format: "date-time" }), T.Null()]),
  nextRunAt: T.Union([T.String({ format: "date-time" }), T.Null()]),
  lastRun: T.Union([
    T.Object({
      status: T.String(),
      sizeBytes: T.Union([T.Number(), T.Null()]),
      finishedAt: T.Union([T.String({ format: "date-time" }), T.Null()]),
    }),
    T.Null(),
  ]),
  createdAt: T.String({ format: "date-time" }),
});

const Dest = T.Object(
  {
    provider: T.String({ minLength: 1, maxLength: 64 }),
    accessKeyId: T.String({ minLength: 1, maxLength: 256 }),
    secretAccessKey: T.String({ minLength: 1, maxLength: 256 }),
    region: T.Optional(T.String({ maxLength: 64 })),
    endpoint: T.Optional(T.String({ maxLength: 2048 })),
    bucket: T.String({ minLength: 1, maxLength: 255 }),
  },
  { additionalProperties: false },
);

const CreateConfig = T.Object(
  {
    serverId: T.String(),
    databaseId: T.String(),
    schedule: T.String({ minLength: 9, maxLength: 64 }),
    keepNewest: T.Optional(T.Integer({ minimum: 1, maximum: 365 })),
    retentionDays: T.Optional(T.Integer({ minimum: 1, maximum: 3650 })),
    dest: Dest,
    prefix: T.Optional(T.String({ maxLength: 255 })),
  },
  { additionalProperties: false },
);

const RunView = T.Object({
  id: T.String(),
  status: T.String(),
  location: T.Union([T.String(), T.Null()]),
  sizeBytes: T.Union([T.Number(), T.Null()]),
  error: T.Union([T.String(), T.Null()]),
  startedAt: T.String({ format: "date-time" }),
  finishedAt: T.Union([T.String({ format: "date-time" }), T.Null()]),
});

// PITR (physical base + WAL archiving) — server-level (no databaseId).
const CreatePitr = T.Object(
  {
    serverId: T.String(),
    schedule: T.String({ minLength: 9, maxLength: 64 }), // base-backup cron
    walSchedule: T.Optional(T.String({ minLength: 9, maxLength: 64 })), // WAL-drain cron
    keepNewest: T.Optional(T.Integer({ minimum: 1, maximum: 365 })),
    retentionDays: T.Optional(T.Integer({ minimum: 1, maximum: 3650 })),
    dest: Dest,
    prefix: T.Optional(T.String({ maxLength: 255 })),
  },
  { additionalProperties: false },
);

const RestorePlanQuery = T.Object(
  {
    targetTime: T.Optional(T.String({ maxLength: 40 })), // ISO; recover to this instant
    dataDir: T.Optional(T.String({ maxLength: 512 })),
    baseRunId: T.Optional(T.String()),
  },
  { additionalProperties: false },
);
const RestorePlanView = T.Object({
  base: T.Union([
    T.Object({
      runId: T.String(),
      location: T.String(),
      finishedAt: T.Union([T.String(), T.Null()]),
    }),
    T.Null(),
  ]),
  targetTime: T.Union([T.String(), T.Null()]),
  dataDir: T.String(),
  steps: T.Array(T.Object({ title: T.String(), command: T.String() })),
  note: T.String(),
});

const RestoreRun = T.Object(
  {
    targetTime: T.Optional(T.String({ maxLength: 40 })), // ISO; recover to this instant
    baseRunId: T.Optional(T.String()),
    port: T.Optional(T.Integer({ minimum: 1024, maximum: 65535 })),
  },
  { additionalProperties: false },
);
const RestoreInstanceView = T.Object({
  ok: T.Boolean(),
  container: T.Union([T.String(), T.Null()]),
  port: T.Union([T.Integer(), T.Null()]),
  pgVersion: T.Union([T.String(), T.Null()]),
  recovered: T.Boolean(),
  error: T.Optional(T.String()),
});

const IdParam = T.Object({ id: T.String() });

export const backupsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/backup-configs",
    {
      schema: { tags: ["backups"], response: { 200: T.Array(ConfigView) } },
      preHandler: app.requirePermission("server:read"),
    },
    async (req) => backupsService.listBackupConfigs(app.db, getOrgId(req)),
  );

  app.post(
    "/backup-configs",
    {
      schema: {
        tags: ["backups"],
        body: CreateConfig,
        response: { 201: ConfigView, 400: Problem },
      },
      preHandler: app.requirePermission("server:write"),
    },
    async (req, reply) => {
      const orgId = getOrgId(req);
      const created = await backupsService.createBackupConfig(app.db, app.config, orgId, req.body);
      try {
        const row = await backupsService.getBackupConfigRow(app.db, orgId, created.id);
        await backupsService.syncBackupConfig(app.db, app.config, app.queue, row);
      } catch (err) {
        app.log.warn?.({ err }, "backup cron registration skipped");
      }
      reply.code(201);
      return created;
    },
  );

  app.delete(
    "/backup-configs/:id",
    {
      schema: { tags: ["backups"], params: IdParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("server:write"),
    },
    async (req, reply) => {
      await backupsService.deleteBackupConfig(app.db, app.queue, getOrgId(req), req.params.id);
      reply.code(204);
      return null;
    },
  );

  app.post(
    "/backup-configs/:id/run",
    {
      schema: {
        tags: ["backups"],
        params: IdParam,
        response: { 202: T.Object({ started: T.Boolean() }), 404: Problem },
      },
      preHandler: app.requirePermission("server:write"),
    },
    async (req, reply) => {
      const row = await backupsService.getBackupConfigRow(app.db, getOrgId(req), req.params.id);
      void backupsService.runBackupConfigNow(app.db, app.config, row);
      reply.code(202);
      return { started: true };
    },
  );

  // Enable PITR on a managed Postgres server (physical base backups + WAL
  // archiving). Registers both cron queues + creates the slot immediately.
  app.post(
    "/backup-configs/pitr",
    {
      schema: { tags: ["backups"], body: CreatePitr, response: { 201: ConfigView, 400: Problem } },
      preHandler: app.requirePermission("server:write"),
    },
    async (req, reply) => {
      const orgId = getOrgId(req);
      const created = await backupsService.createPitrConfig(app.db, app.config, orgId, req.body);
      try {
        const row = await backupsService.getBackupConfigRow(app.db, orgId, created.id);
        await backupsService.syncBackupConfig(app.db, app.config, app.queue, row);
        // create the slot + start retaining WAL right away (best-effort).
        void backupsService.runWalDrainNow(app.db, app.config, row);
      } catch (err) {
        app.log.warn?.({ err }, "pitr cron registration skipped");
      }
      reply.code(201);
      return created;
    },
  );

  app.post(
    "/backup-configs/:id/base-backup",
    {
      schema: {
        tags: ["backups"],
        params: IdParam,
        response: { 202: T.Object({ started: T.Boolean() }), 404: Problem },
      },
      preHandler: app.requirePermission("server:write"),
    },
    async (req, reply) => {
      const row = await backupsService.getBackupConfigRow(app.db, getOrgId(req), req.params.id);
      void backupsService.runBaseBackupNow(app.db, app.config, row);
      reply.code(202);
      return { started: true };
    },
  );

  app.post(
    "/backup-configs/:id/wal-archive",
    {
      schema: {
        tags: ["backups"],
        params: IdParam,
        response: { 202: T.Object({ started: T.Boolean() }), 404: Problem },
      },
      preHandler: app.requirePermission("server:write"),
    },
    async (req, reply) => {
      const row = await backupsService.getBackupConfigRow(app.db, getOrgId(req), req.params.id);
      void backupsService.runWalDrainNow(app.db, app.config, row);
      reply.code(202);
      return { started: true };
    },
  );

  // The recovery runbook embeds the S3 credential → server:write (not :read).
  app.get(
    "/backup-configs/:id/restore-plan",
    {
      schema: {
        tags: ["backups"],
        params: IdParam,
        querystring: RestorePlanQuery,
        response: { 200: RestorePlanView, 400: Problem, 404: Problem },
      },
      preHandler: app.requirePermission("server:write"),
    },
    async (req) =>
      backupsService.restorePlan(app.db, app.config, getOrgId(req), req.params.id, {
        ...(req.query.targetTime ? { targetTime: req.query.targetTime } : {}),
        ...(req.query.dataDir ? { dataDir: req.query.dataDir } : {}),
        ...(req.query.baseRunId ? { baseRunId: req.query.baseRunId } : {}),
      }),
  );

  // Automated PITR restore into a fresh postgres container (server:write — stages
  // creds + spins up a container). Synchronous: the caller waits for recovery.
  app.post(
    "/backup-configs/:id/restore-run",
    {
      schema: {
        tags: ["backups"],
        params: IdParam,
        body: RestoreRun,
        response: { 200: RestoreInstanceView, 400: Problem, 404: Problem },
      },
      preHandler: app.requirePermission("server:write"),
    },
    async (req) =>
      backupsService.restoreToInstance(app.db, app.config, getOrgId(req), req.params.id, {
        ...(req.body.targetTime ? { targetTime: req.body.targetTime } : {}),
        ...(req.body.baseRunId ? { baseRunId: req.body.baseRunId } : {}),
        ...(req.body.port !== undefined ? { port: req.body.port } : {}),
      }),
  );

  app.post(
    "/backup-configs/:id/runs/:runId/restore",
    {
      schema: {
        tags: ["backups"],
        params: T.Object({ id: T.String(), runId: T.String() }),
        response: {
          200: T.Object({ ok: T.Boolean(), error: T.Optional(T.String()) }),
          400: Problem,
          404: Problem,
        },
      },
      preHandler: app.requirePermission("server:write"),
    },
    // Synchronous and destructive (pg_restore --clean) — the caller waits.
    async (req) =>
      backupsService.restoreBackupRun(
        app.db,
        app.config,
        getOrgId(req),
        req.params.id,
        req.params.runId,
      ),
  );

  app.get(
    "/backup-configs/:id/runs",
    {
      schema: {
        tags: ["backups"],
        params: IdParam,
        response: { 200: T.Array(RunView), 404: Problem },
      },
      preHandler: app.requirePermission("server:read"),
    },
    async (req) => backupsService.listBackupRuns(app.db, getOrgId(req), req.params.id),
  );
};
