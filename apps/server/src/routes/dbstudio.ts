import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";
import { AppError } from "@ss/shared";

import type { BrowseFilter, FilterOp } from "../dbstudio/introspect/types.js";
import { classify } from "../dbstudio/sql/guard.js";
import { getCtx, getOrgId } from "../lib/ctx.js";
import { checkPermission } from "../rbac/require-permission.js";
import { Problem } from "../schemas/common.js";
import { dbStudioAuditEvent, recordAudit } from "../services/audit.service.js";
import * as dbStudio from "../services/dbstudio.service.js";

// Database Studio REST (database-studio/01). Server-side proxy: the browser
// never receives DB credentials — it browses through these endpoints. RBAC:
// dbstudio:read to list/introspect/browse, dbstudio:connect to manage external
// profiles. Connection ids are opaque ("managed:db_…" | "ext:dbc_…").

const Engine = T.Union([T.Literal("postgres"), T.Literal("mysql"), T.Literal("mariadb")]);

const ConnectionView = T.Object({
  id: T.String(),
  source: T.Union([T.Literal("managed"), T.Literal("external")]),
  name: T.String(),
  engine: Engine,
  host: T.String(),
  database: T.String(),
  readOnly: T.Boolean(),
  appId: T.Union([T.String(), T.Null()]),
});

const CreateExternal = T.Object(
  {
    name: T.String({ minLength: 1, maxLength: 120 }),
    engine: Engine,
    host: T.String({ minLength: 1, maxLength: 253 }),
    port: T.Integer({ minimum: 1, maximum: 65535 }),
    database: T.String({ minLength: 1, maxLength: 128 }),
    username: T.String({ minLength: 1, maxLength: 128 }),
    password: T.String({ maxLength: 1024 }),
    tls: T.Optional(T.Boolean()),
    readOnly: T.Optional(T.Boolean()),
  },
  { additionalProperties: false },
);

const TestResult = T.Object({
  ok: T.Boolean(),
  serverVersion: T.Optional(T.String()),
  error: T.Optional(T.String()),
});

const TableNode = T.Object({
  schema: T.String(),
  name: T.String(),
  kind: T.Union([T.Literal("table"), T.Literal("view")]),
  estimatedRows: T.Union([T.Integer(), T.Null()]),
});
const SchemaTree = T.Array(T.Object({ name: T.String(), tables: T.Array(TableNode) }));

const ColumnInfo = T.Object({
  name: T.String(),
  dataType: T.String(),
  uiType: T.String(),
  nullable: T.Boolean(),
  default: T.Union([T.String(), T.Null()]),
  isPrimaryKey: T.Boolean(),
});
const ForeignKey = T.Object({
  name: T.String(),
  columns: T.Array(T.String()),
  refSchema: T.String(),
  refTable: T.String(),
  refColumns: T.Array(T.String()),
});
const IndexInfo = T.Object({
  name: T.String(),
  columns: T.Array(T.String()),
  unique: T.Boolean(),
  primary: T.Boolean(),
});
const TableDetail = T.Object({
  schema: T.String(),
  name: T.String(),
  columns: T.Array(ColumnInfo),
  primaryKey: T.Array(T.String()),
  indexes: T.Array(IndexInfo),
  foreignKeys: T.Array(ForeignKey),
});

const RowsResponse = T.Object({
  fields: T.Array(T.Object({ name: T.String(), dataType: T.String() })),
  rows: T.Array(T.Record(T.String(), T.Unknown())),
  primaryKey: T.Array(T.String()),
  page: T.Object({ limit: T.Integer(), offset: T.Integer(), hasMore: T.Boolean() }),
});

const ConnParam = T.Object({ id: T.String() });
const TableParams = T.Object({ id: T.String(), schema: T.String(), table: T.String() });
const RowsQuery = T.Object(
  {
    limit: T.Optional(T.Integer({ minimum: 1, maximum: 1000, default: 100 })),
    offset: T.Optional(T.Integer({ minimum: 0, default: 0 })),
    sort: T.Optional(T.String({ maxLength: 200 })), // "column:asc" | "column:desc"
    filters: T.Optional(T.String({ maxLength: 2000 })), // JSON: [{column,op,value?}]
  },
  { additionalProperties: false },
);

const RunQuery = T.Object(
  { sql: T.String({ minLength: 1, maxLength: 20000 }), confirm: T.Optional(T.Boolean()) },
  { additionalProperties: false },
);
const RunResult = T.Object({
  fields: T.Array(T.Object({ name: T.String(), dataType: T.String() })),
  rows: T.Array(T.Record(T.String(), T.Unknown())),
  rowCount: T.Integer(),
  command: T.String(),
  elapsedMs: T.Integer(),
  truncated: T.Boolean(),
});

const RowEditSchema = T.Object(
  {
    op: T.Union([T.Literal("insert"), T.Literal("update"), T.Literal("delete")]),
    schema: T.String({ minLength: 1 }),
    table: T.String({ minLength: 1 }),
    pk: T.Optional(T.Record(T.String(), T.Unknown())),
    values: T.Optional(T.Record(T.String(), T.Unknown())),
  },
  { additionalProperties: false },
);
const ApplyEdits = T.Object(
  { edits: T.Array(RowEditSchema, { minItems: 1, maxItems: 200 }) },
  { additionalProperties: false },
);
const EditsResult = T.Object({
  applied: T.Integer(),
  results: T.Array(T.Object({ rowCount: T.Integer(), command: T.String() })),
});

const FILTER_OPS = new Set<FilterOp>(["eq", "ne", "like", "isnull", "notnull"]);

function parseSort(sort: string | undefined): { column: string; dir: "asc" | "desc" } | undefined {
  if (!sort) return undefined;
  const idx = sort.lastIndexOf(":");
  const column = idx === -1 ? sort : sort.slice(0, idx);
  const dir = idx === -1 ? "asc" : sort.slice(idx + 1);
  if (!column) return undefined;
  return { column, dir: dir === "desc" ? "desc" : "asc" };
}

function parseFilters(raw: string | undefined): BrowseFilter[] | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("filters must be a JSON array", {
      status: 400,
      code: "dbstudio.bad_filter",
    });
  }
  if (!Array.isArray(parsed)) {
    throw new AppError("filters must be a JSON array", {
      status: 400,
      code: "dbstudio.bad_filter",
    });
  }
  return parsed.map((f) => {
    const o = f as { column?: unknown; op?: unknown; value?: unknown };
    if (
      typeof o.column !== "string" ||
      typeof o.op !== "string" ||
      !FILTER_OPS.has(o.op as FilterOp)
    ) {
      throw new AppError("invalid filter", { status: 400, code: "dbstudio.bad_filter" });
    }
    return {
      column: o.column,
      op: o.op as FilterOp,
      ...(typeof o.value === "string" ? { value: o.value } : {}),
    };
  });
}

export const dbStudioRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/db-connections",
    {
      schema: { tags: ["dbstudio"], response: { 200: T.Array(ConnectionView) } },
      preHandler: app.requirePermission("dbstudio:read"),
    },
    async (req) => dbStudio.listConnections(app.db, getOrgId(req)),
  );

  app.post(
    "/db-connections",
    {
      schema: {
        tags: ["dbstudio"],
        body: CreateExternal,
        response: { 201: ConnectionView, 400: Problem },
      },
      preHandler: app.requirePermission("dbstudio:connect"),
    },
    async (req, reply) => {
      const created = await dbStudio.createExternalConnection(
        app.db,
        app.config,
        getOrgId(req),
        req.body,
        {
          createdBy: getCtx(req).actor.userId ?? null,
        },
      );
      reply.code(201);
      return created;
    },
  );

  app.delete(
    "/db-connections/:id",
    {
      schema: { tags: ["dbstudio"], params: ConnParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("dbstudio:connect"),
    },
    async (req, reply) => {
      await dbStudio.deleteExternalConnection(app.db, getOrgId(req), req.params.id);
      reply.code(204);
      return null;
    },
  );

  app.post(
    "/db-connections/:id/test",
    {
      schema: {
        tags: ["dbstudio"],
        params: ConnParam,
        response: { 200: TestResult, 404: Problem },
      },
      preHandler: app.requirePermission("dbstudio:read"),
    },
    async (req) => dbStudio.testConnection(app.db, app.config, getOrgId(req), req.params.id),
  );

  app.get(
    "/db-connections/:id/schema",
    {
      schema: {
        tags: ["dbstudio"],
        params: ConnParam,
        response: { 200: SchemaTree, 404: Problem },
      },
      preHandler: app.requirePermission("dbstudio:read"),
    },
    async (req) => dbStudio.getSchema(app.db, app.config, getOrgId(req), req.params.id),
  );

  app.get(
    "/db-connections/:id/tables/:schema/:table",
    {
      schema: {
        tags: ["dbstudio"],
        params: TableParams,
        response: { 200: TableDetail, 404: Problem },
      },
      preHandler: app.requirePermission("dbstudio:read"),
    },
    async (req) =>
      dbStudio.getTableDetail(
        app.db,
        app.config,
        getOrgId(req),
        req.params.id,
        req.params.schema,
        req.params.table,
      ),
  );

  app.get(
    "/db-connections/:id/tables/:schema/:table/rows",
    {
      schema: {
        tags: ["dbstudio"],
        params: TableParams,
        querystring: RowsQuery,
        response: { 200: RowsResponse, 400: Problem, 404: Problem },
      },
      preHandler: app.requirePermission("dbstudio:read"),
    },
    async (req) => {
      const sort = parseSort(req.query.sort);
      const filters = parseFilters(req.query.filters);
      return dbStudio.getRows(app.db, app.config, getOrgId(req), req.params.id, {
        schema: req.params.schema,
        table: req.params.table,
        limit: req.query.limit ?? 100,
        offset: req.query.offset ?? 0,
        ...(sort ? { sort } : {}),
        ...(filters ? { filters } : {}),
      });
    },
  );

  // SQL runner (database-studio/03). Reads need the route's dbstudio:read gate;
  // writes additionally require dbstudio:write (checked per-statement) and a
  // non-read-only connection, with destructive statements needing confirm.
  app.post(
    "/db-connections/:id/query",
    {
      schema: {
        tags: ["dbstudio"],
        params: ConnParam,
        body: RunQuery,
        response: { 200: RunResult, 400: Problem, 403: Problem, 404: Problem, 409: Problem },
      },
      preHandler: app.requirePermission("dbstudio:read"),
    },
    async (req) => {
      const canWrite = checkPermission(req.ctx, "dbstudio:write").ok;
      const result = await dbStudio.runQuery(
        app.db,
        app.config,
        getOrgId(req),
        req.params.id,
        req.body.sql,
        { canWrite, ...(req.body.confirm !== undefined ? { confirm: req.body.confirm } : {}) },
      );
      // Audit writes only (reads are not individually audited; database-studio/04).
      const cls = classify(req.body.sql);
      if (cls.statementClass !== "read") {
        const ev = dbStudioAuditEvent(getCtx(req), "query", req.params.id, {
          class: cls.statementClass,
          destructive: cls.destructive,
          rowCount: result.rowCount,
          elapsedMs: result.elapsedMs,
        });
        if (ev) void recordAudit(app.db, ev);
      }
      return result;
    },
  );

  // Apply structured row edits atomically (the commit bar). dbstudio:write; the
  // service refuses a read-only connection and runs the batch in one transaction.
  app.post(
    "/db-connections/:id/edits",
    {
      schema: {
        tags: ["dbstudio"],
        params: ConnParam,
        body: ApplyEdits,
        response: { 200: EditsResult, 400: Problem, 404: Problem, 409: Problem },
      },
      preHandler: app.requirePermission("dbstudio:write"),
    },
    async (req) => {
      const out = await dbStudio.runEdits(
        app.db,
        app.config,
        getOrgId(req),
        req.params.id,
        req.body.edits,
      );
      const ev = dbStudioAuditEvent(getCtx(req), "edits", req.params.id, {
        applied: out.applied,
        edits: req.body.edits.length,
      });
      if (ev) void recordAudit(app.db, ev);
      return out;
    },
  );
};
