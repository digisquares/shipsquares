import { AppError } from "@ss/shared";
import type { Env } from "@ss/shared";
import postgres from "postgres";

import type { Db } from "../db/index.js";

import { getServerAdminUrl } from "./databases.service.js";

// DB performance diagnostics for managed Postgres servers (db-performance.md):
// read pg_stat_statements over the server's one-shot admin connection and return
// the hottest statements + cluster totals. The admin role can read all stats and
// reset, so — unlike AGMS — no GRANT migration is needed. Query text comes back
// normalized ($1, $2 …) by the extension, so no row literals/PII leak.

export interface StatementRow {
  /** 1-based rank by total execution time within the snapshot. */
  rank: number;
  /** pg_stat_statements queryid (stable fingerprint), or "" when unavailable. */
  queryid: string;
  /** Database (datname) this statement's dbid resolves to. */
  database: string;
  calls: number;
  /** Total execution time across all calls, in milliseconds. */
  totalMs: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
  stddevMs: number;
  rows: number;
  blksHit: number;
  blksRead: number;
  /** Shared-buffer hit ratio (0–100), or null when no blocks were touched. */
  hitPct: number | null;
  /** Normalized SQL text, or '<insufficient privilege>' for other roles. */
  query: string;
}

export interface PgssSnapshot {
  serverId: string;
  serverVersion: string;
  /** ISO timestamp of the last reset, or null if never reset. */
  statsReset: string | null;
  /** ISO timestamp when this snapshot was captured. */
  capturedAt: string;
  totals: {
    distinctStatements: number;
    totalCalls: number;
    totalExecMs: number;
  };
  statements: StatementRow[];
}

/** The snapshot built entirely in SQL: one json_build_object row, columns
 *  aliased to the camelCase response keys so the service does zero reshaping.
 *  Cluster-wide (the admin connection sees every database's statements); each
 *  row is labelled with its database via dbid → pg_database.datname. $1 = limit.
 *  Modern column names (PG ≥ 13). */
const SNAPSHOT_SQL = `
  SELECT json_build_object(
    'serverVersion', (SELECT setting FROM pg_settings WHERE name = 'server_version'),
    'statsReset', (SELECT stats_reset FROM pg_stat_statements_info),
    'capturedAt', now(),
    'totals', (
      SELECT json_build_object(
        'distinctStatements', count(*),
        'totalCalls', COALESCE(sum(calls), 0),
        'totalExecMs', round(COALESCE(sum(total_exec_time), 0)::numeric, 1)
      )
      FROM pg_stat_statements
    ),
    'statements', COALESCE((
      SELECT json_agg(t) FROM (
        SELECT
          row_number() OVER (ORDER BY s.total_exec_time DESC) AS rank,
          COALESCE(s.queryid::text, '')             AS queryid,
          COALESCE(d.datname, '')                   AS "database",
          s.calls,
          round(s.total_exec_time::numeric, 1)      AS "totalMs",
          round(s.mean_exec_time::numeric, 2)       AS "meanMs",
          round(s.min_exec_time::numeric, 2)        AS "minMs",
          round(s.max_exec_time::numeric, 2)        AS "maxMs",
          round(s.stddev_exec_time::numeric, 2)     AS "stddevMs",
          s.rows,
          s.shared_blks_hit                         AS "blksHit",
          s.shared_blks_read                        AS "blksRead",
          round(100.0 * s.shared_blks_hit
            / NULLIF(s.shared_blks_hit + s.shared_blks_read, 0), 1) AS "hitPct",
          s.query
        FROM pg_stat_statements s
        LEFT JOIN pg_database d ON d.oid = s.dbid
        ORDER BY s.total_exec_time DESC
        LIMIT $1
      ) t
    ), '[]'::json)
  ) AS result;
`;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Belt-and-suspenders bound on top of the route's TypeBox validation. */
export function clampLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(raw), 1), MAX_LIMIT);
}

/** Run a sequence over a one-shot admin connection (mirrors databases.service). */
async function withAdmin<T>(adminUrl: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

/** Lazily install the extension; fail closed with an actionable 503 when the
 *  library isn't preloaded (a restart-only GUC we can't set from SQL). */
async function ensureExtension(sql: postgres.Sql): Promise<void> {
  try {
    await sql.unsafe("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const detail = /shared_preload_libraries/i.test(msg)
      ? "pg_stat_statements is not enabled on this server. Add 'pg_stat_statements' to shared_preload_libraries in postgresql.conf and restart Postgres."
      : `could not enable pg_stat_statements: ${msg}`;
    throw new AppError(detail, { status: 503, code: "db_performance.extension_unavailable" });
  }
}

async function selectSnapshot(
  sql: postgres.Sql,
  serverId: string,
  limit: number,
): Promise<PgssSnapshot> {
  const rows = await sql.unsafe(SNAPSHOT_SQL, [clampLimit(limit)]);
  const result = (rows[0] as { result?: Omit<PgssSnapshot, "serverId"> } | undefined)?.result;
  if (!result) {
    throw new AppError("pg_stat_statements returned no data", {
      status: 503,
      code: "db_performance.no_data",
    });
  }
  return { serverId, ...result };
}

export async function snapshot(
  db: Db,
  config: Env,
  orgId: string,
  serverId: string,
  limit?: number,
): Promise<PgssSnapshot> {
  const adminUrl = await getServerAdminUrl(db, config, orgId, serverId);
  return withAdmin(adminUrl, async (sql) => {
    await ensureExtension(sql);
    return selectSnapshot(sql, serverId, limit ?? DEFAULT_LIMIT);
  });
}

export async function reset(
  db: Db,
  config: Env,
  orgId: string,
  serverId: string,
  limit?: number,
): Promise<PgssSnapshot> {
  const adminUrl = await getServerAdminUrl(db, config, orgId, serverId);
  return withAdmin(adminUrl, async (sql) => {
    await ensureExtension(sql);
    await sql.unsafe("SELECT pg_stat_statements_reset()");
    return selectSnapshot(sql, serverId, limit ?? DEFAULT_LIMIT);
  });
}
