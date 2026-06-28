import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as dbPerformanceService from "../services/db-performance.service.js";

// pg_stat_statements diagnostics for managed Postgres servers (db-performance.md).
// Managed infra → server:read to view, server:write to reset (same RBAC as the
// rest of the managed-DB surface). Query text is normalized by the extension, so
// the snapshot carries query shapes + timings only — never row literals/PII.

const StatementRow = T.Object({
  rank: T.Integer(),
  queryid: T.String(),
  database: T.String(),
  calls: T.Integer(),
  totalMs: T.Number(),
  meanMs: T.Number(),
  minMs: T.Number(),
  maxMs: T.Number(),
  stddevMs: T.Number(),
  rows: T.Integer(),
  blksHit: T.Integer(),
  blksRead: T.Integer(),
  hitPct: T.Union([T.Number(), T.Null()]),
  query: T.String(),
});

const Snapshot = T.Object({
  serverId: T.String(),
  serverVersion: T.String(),
  statsReset: T.Union([T.String(), T.Null()]),
  capturedAt: T.String(),
  totals: T.Object({
    distinctStatements: T.Integer(),
    totalCalls: T.Integer(),
    totalExecMs: T.Number(),
  }),
  statements: T.Array(StatementRow),
});

const IdParam = T.Object({ id: T.String() });
const LimitQuery = T.Object({
  limit: T.Optional(T.Integer({ minimum: 1, maximum: 200, default: 50 })),
});

export const dbPerformanceRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/database-servers/:id/pg-stat-statements",
    {
      schema: {
        tags: ["databases"],
        params: IdParam,
        querystring: LimitQuery,
        response: { 200: Snapshot, 404: Problem, 503: Problem },
      },
      preHandler: app.requirePermission("server:read"),
    },
    async (req) =>
      dbPerformanceService.snapshot(
        app.db,
        app.config,
        getOrgId(req),
        req.params.id,
        req.query.limit,
      ),
  );

  app.post(
    "/database-servers/:id/pg-stat-statements/reset",
    {
      schema: {
        tags: ["databases"],
        params: IdParam,
        querystring: LimitQuery,
        response: { 200: Snapshot, 404: Problem, 503: Problem },
      },
      preHandler: app.requirePermission("server:write"),
    },
    async (req) =>
      dbPerformanceService.reset(app.db, app.config, getOrgId(req), req.params.id, req.query.limit),
  );
};
