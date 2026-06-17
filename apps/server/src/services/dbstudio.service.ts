import { lookup } from "node:dns/promises";

import { AppError, NotFoundError, newId } from "@ss/shared";
import type { Env } from "@ss/shared";
import { and, asc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { databaseServers, databases, dbConnections } from "../db/schema/index.js";
import type { DbDriver, QueryExecResult, QueryRunResult } from "../dbstudio/engines/types.js";
import { introspectorFor } from "../dbstudio/introspect/index.js";
import type {
  BrowseSpec,
  RowsPage,
  SchemaNode,
  TableDetail,
} from "../dbstudio/introspect/types.js";
import { dbStudioPool, type DbStudioPool } from "../dbstudio/pool.js";
import { resolveConnection, type ResolveDeps } from "../dbstudio/resolve.js";
import { buildBrowseQuery } from "../dbstudio/sql/browse.js";
import { buildStatement, type RowEdit } from "../dbstudio/sql/dml.js";
import { classify, enforceRowLimit } from "../dbstudio/sql/guard.js";
import { assertHostAllowed } from "../dbstudio/ssrf.js";
import { loadMasterKey, open, seal } from "../secrets/crypto.js";
import type { SealedValue } from "../secrets/types.js";

// Database Studio orchestration (database-studio/01). Row-logic (list/create/
// delete connection profiles) is org-scoped CRUD — pglite-tested. Driver-glue
// (schema/tableDetail/rows) composes the introspectors + browse builder over a
// pooled driver; the introspectors are exercised against real Postgres (pglite)
// via these functions in the integration test. The browser never sees credentials.

const KEY_VERSION = 1;
const STMT_TIMEOUT_MS = 15_000;
const MAX_ROWS = 1000;

function masterKey(config: Env): Buffer {
  try {
    return loadMasterKey(config.SHIPSQUARES_MASTER_KEY);
  } catch {
    throw new AppError("Database Studio requires SHIPSQUARES_MASTER_KEY", {
      status: 400,
      code: "secrets.unconfigured",
    });
  }
}
const sealStr = (plain: string, config: Env): string =>
  JSON.stringify(seal(plain, masterKey(config), KEY_VERSION));
const openStr = (s: string, config: Env): string =>
  open(JSON.parse(s) as SealedValue, masterKey(config));

const allowPrivateHosts = (): boolean => process.env.DBSTUDIO_ALLOW_PRIVATE_HOSTS === "true";
const defaultResolve = async (host: string): Promise<string[]> =>
  (await lookup(host, { all: true })).map((r) => r.address);

export interface ConnectionView {
  id: string;
  source: "managed" | "external";
  name: string;
  engine: "postgres" | "mysql" | "mariadb";
  host: string;
  database: string;
  readOnly: boolean;
  appId: string | null;
}

type ExtRow = typeof dbConnections.$inferSelect;
function toExternalView(r: ExtRow): ConnectionView {
  return {
    id: `ext:${r.id}`,
    source: "external",
    name: r.name,
    engine: r.engine,
    host: r.host,
    database: r.database,
    readOnly: r.readOnly,
    appId: null,
  };
}

/** Managed connections (synthesized from database_servers/databases) + saved
 *  external profiles. Secrets are NEVER read here — only at resolve time. */
export async function listConnections(db: Db, orgId: string): Promise<ConnectionView[]> {
  const managed = await db
    .select({
      id: databases.id,
      name: databases.name,
      appId: databases.appId,
      engine: databaseServers.engine,
      host: databaseServers.host,
    })
    .from(databases)
    .innerJoin(databaseServers, eq(databaseServers.id, databases.serverId))
    .where(eq(databases.organizationId, orgId));
  const external = await db
    .select()
    .from(dbConnections)
    .where(eq(dbConnections.organizationId, orgId))
    .orderBy(asc(dbConnections.createdAt));

  const managedViews: ConnectionView[] = managed.map((r) => ({
    id: `managed:${r.id}`,
    source: "managed",
    name: r.name,
    engine: r.engine,
    host: r.host,
    database: r.name,
    readOnly: true,
    appId: r.appId,
  }));
  return [...managedViews, ...external.map(toExternalView)];
}

export interface CreateExternalInput {
  name: string;
  engine: "postgres" | "mysql" | "mariadb";
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  tls?: boolean;
  readOnly?: boolean;
}

export async function createExternalConnection(
  db: Db,
  config: Env,
  orgId: string,
  input: CreateExternalInput,
  deps: { resolve?: (h: string) => Promise<string[]>; createdBy?: string | null } = {},
): Promise<ConnectionView> {
  // SSRF guard first (cheap, no master key needed); then seal + persist.
  await assertHostAllowed(input.host, {
    allowPrivate: allowPrivateHosts(),
    resolve: deps.resolve ?? defaultResolve,
  });
  const row = (
    await db
      .insert(dbConnections)
      .values({
        id: newId("dbc"),
        organizationId: orgId,
        name: input.name,
        engine: input.engine,
        host: input.host,
        port: input.port,
        database: input.database,
        username: input.username,
        passwordSecretRef: sealStr(input.password, config),
        tls: input.tls ?? true,
        readOnly: input.readOnly ?? true,
        createdBy: deps.createdBy ?? null,
      })
      .returning()
  )[0]!;
  return toExternalView(row);
}

export async function deleteExternalConnection(
  db: Db,
  orgId: string,
  id: string,
  pool: DbStudioPool = dbStudioPool,
): Promise<void> {
  const rawId = id.startsWith("ext:") ? id.slice(4) : id;
  const rows = await db
    .delete(dbConnections)
    .where(and(eq(dbConnections.id, rawId), eq(dbConnections.organizationId, orgId)))
    .returning({ id: dbConnections.id });
  if (!rows[0]) throw new NotFoundError("connection not found");
  await pool.evict(`ext:${rawId}`);
}

// ── Driver-glue (testable with a fake/pglite-backed driver) ──────────────────

export async function schemaFor(driver: DbDriver): Promise<SchemaNode[]> {
  return introspectorFor(driver.engine).schemas(driver.query);
}

export async function tableDetailFor(
  driver: DbDriver,
  schema: string,
  table: string,
): Promise<TableDetail> {
  return introspectorFor(driver.engine).tableDetail(driver.query, schema, table);
}

export async function rowsFor(
  driver: DbDriver,
  maxRows: number,
  spec: BrowseSpec,
): Promise<RowsPage> {
  const detail = await introspectorFor(driver.engine).tableDetail(
    driver.query,
    spec.schema,
    spec.table,
  );
  if (detail.columns.length === 0) throw new NotFoundError("table not found");
  const built = buildBrowseQuery(driver.engine, spec, detail.columns, maxRows);
  const res = await driver.query(built.sql, built.params);
  const hasMore = res.rows.length > built.appliedLimit;
  return {
    fields: res.fields.length
      ? res.fields
      : detail.columns.map((c) => ({ name: c.name, dataType: c.dataType })),
    rows: hasMore ? res.rows.slice(0, built.appliedLimit) : res.rows,
    primaryKey: detail.primaryKey,
    page: { limit: built.appliedLimit, offset: spec.offset, hasMore },
  };
}

/** Run a single SQL statement. Writes are allowed only when the connection is
 *  not read-only AND the caller holds dbstudio:write (canWrite); destructive
 *  statements need an explicit confirm. Rejects multi-statement input, applies
 *  the row cap, and times it. `now` is injected for deterministic tests. */
export async function execQuery(
  driver: DbDriver,
  opts: { readOnly: boolean; canWrite: boolean; maxRows: number; confirm?: boolean },
  sql: string,
  now: () => number = Date.now,
): Promise<QueryRunResult> {
  const a = classify(sql);
  if (a.statementCount === 0) {
    throw new AppError("empty query", { status: 400, code: "dbstudio.empty_query" });
  }
  if (a.statementCount > 1) {
    throw new AppError("run one statement at a time", {
      status: 400,
      code: "dbstudio.multiple_statements",
    });
  }
  if (a.statementClass !== "read") {
    if (opts.readOnly) {
      throw new AppError("this connection is read-only", {
        status: 409,
        code: "dbstudio.read_only",
      });
    }
    if (!opts.canWrite) {
      throw new AppError("writing requires the dbstudio:write permission", {
        status: 403,
        code: "auth.forbidden",
      });
    }
    if (a.destructive && !opts.confirm) {
      throw new AppError("destructive statement needs explicit confirmation", {
        status: 409,
        code: "dbstudio.confirm_required",
      });
    }
  }
  const finalSql = a.statementClass === "read" ? enforceRowLimit(sql, opts.maxRows + 1) : sql;
  const started = now();
  const res = await driver.query(finalSql);
  const elapsedMs = now() - started;
  const truncated = res.rows.length > opts.maxRows;
  return {
    fields: res.fields,
    rows: truncated ? res.rows.slice(0, opts.maxRows) : res.rows,
    rowCount: res.rowCount,
    command: res.command,
    elapsedMs,
    truncated,
  };
}

// ── IO wrappers (resolve → acquire pooled driver → compose) ──────────────────

function resolveDeps(config: Env): ResolveDeps {
  return {
    openSecret: (ref) => openStr(ref, config),
    assertHost: (host) =>
      assertHostAllowed(host, { allowPrivate: allowPrivateHosts(), resolve: defaultResolve }),
    defaults: { statementTimeoutMs: STMT_TIMEOUT_MS, maxRows: MAX_ROWS },
  };
}

async function openDriver(
  db: Db,
  config: Env,
  orgId: string,
  connectionId: string,
  pool: DbStudioPool,
): Promise<{ driver: DbDriver; maxRows: number; readOnly: boolean }> {
  const resolved = await resolveConnection(db, orgId, connectionId, resolveDeps(config));
  return {
    driver: pool.acquire(resolved.id, resolved.config),
    maxRows: resolved.config.maxRows,
    readOnly: resolved.readOnly,
  };
}

export async function getSchema(
  db: Db,
  config: Env,
  orgId: string,
  connectionId: string,
  pool: DbStudioPool = dbStudioPool,
): Promise<SchemaNode[]> {
  const { driver } = await openDriver(db, config, orgId, connectionId, pool);
  return schemaFor(driver);
}

export async function getTableDetail(
  db: Db,
  config: Env,
  orgId: string,
  connectionId: string,
  schema: string,
  table: string,
  pool: DbStudioPool = dbStudioPool,
): Promise<TableDetail> {
  const { driver } = await openDriver(db, config, orgId, connectionId, pool);
  return tableDetailFor(driver, schema, table);
}

export async function getRows(
  db: Db,
  config: Env,
  orgId: string,
  connectionId: string,
  spec: BrowseSpec,
  pool: DbStudioPool = dbStudioPool,
): Promise<RowsPage> {
  const { driver, maxRows } = await openDriver(db, config, orgId, connectionId, pool);
  return rowsFor(driver, maxRows, spec);
}

export async function runQuery(
  db: Db,
  config: Env,
  orgId: string,
  connectionId: string,
  sql: string,
  opts: { canWrite: boolean; confirm?: boolean },
  pool: DbStudioPool = dbStudioPool,
): Promise<QueryRunResult> {
  const { driver, maxRows, readOnly } = await openDriver(db, config, orgId, connectionId, pool);
  return execQuery(
    driver,
    {
      readOnly,
      canWrite: opts.canWrite,
      maxRows,
      ...(opts.confirm !== undefined ? { confirm: opts.confirm } : {}),
    },
    sql,
  );
}

/** Apply structured row edits atomically (the commit bar). Each edit compiles to
 *  a PK-qualified, parameterized statement; the whole batch runs in one
 *  transaction (all-or-nothing). Refused on a read-only connection. */
export async function applyEdits(
  driver: DbDriver,
  readOnly: boolean,
  edits: RowEdit[],
): Promise<{ applied: number; results: QueryExecResult[] }> {
  if (readOnly) {
    throw new AppError("this connection is read-only", { status: 409, code: "dbstudio.read_only" });
  }
  if (edits.length === 0) {
    throw new AppError("no edits to apply", { status: 400, code: "dbstudio.empty_edits" });
  }
  if (edits.length > 200) {
    throw new AppError("too many edits in one batch (max 200)", {
      status: 400,
      code: "dbstudio.too_many_edits",
    });
  }
  const stmts = edits.map((e) => buildStatement(driver.engine, e));
  const results = await driver.transaction(stmts);
  return { applied: results.reduce((n, r) => n + r.rowCount, 0), results };
}

export async function runEdits(
  db: Db,
  config: Env,
  orgId: string,
  connectionId: string,
  edits: RowEdit[],
  pool: DbStudioPool = dbStudioPool,
): Promise<{ applied: number; results: QueryExecResult[] }> {
  const { driver, readOnly } = await openDriver(db, config, orgId, connectionId, pool);
  return applyEdits(driver, readOnly, edits);
}

export async function testConnection(
  db: Db,
  config: Env,
  orgId: string,
  connectionId: string,
  pool: DbStudioPool = dbStudioPool,
): Promise<{ ok: boolean; serverVersion?: string; error?: string }> {
  try {
    const { driver } = await openDriver(db, config, orgId, connectionId, pool);
    const r = await driver.ping();
    return { ok: true, serverVersion: r.serverVersion };
  } catch (e) {
    if (e instanceof NotFoundError) throw e; // cross-tenant/unknown → 404
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
