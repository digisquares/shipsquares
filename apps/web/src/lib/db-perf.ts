// Pure helpers for the DB Performance page (docs/db-performance.md): the response
// shape from GET /database-servers/:id/pg-stat-statements, plus formatting,
// derived KPIs, and a generic statement classifier. Kept dependency-free and
// co-located-tested like the other lib/* utilities.

export interface StatementRow {
  rank: number;
  queryid: string;
  database: string;
  calls: number;
  totalMs: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
  stddevMs: number;
  rows: number;
  blksHit: number;
  blksRead: number;
  hitPct: number | null;
  query: string;
}

export interface PgssSnapshot {
  serverId: string;
  serverVersion: string;
  statsReset: string | null;
  capturedAt: string;
  totals: { distinctStatements: number; totalCalls: number; totalExecMs: number };
  statements: StatementRow[];
}

/** Coarse statement kind from the leading keyword of the normalized SQL. */
export type QueryKind =
  | "SELECT"
  | "INSERT"
  | "UPDATE"
  | "DELETE"
  | "DDL"
  | "TRANSACTION"
  | "UTILITY"
  | "OTHER";

const DDL = /^(CREATE|ALTER|DROP|TRUNCATE|COMMENT|GRANT|REVOKE)\b/;
const TX = /^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|START\s+TRANSACTION)\b/;
const UTILITY = /^(SET|SHOW|RESET|COPY|VACUUM|ANALYZE|EXPLAIN|CALL|DO|WITH)\b/;

export function classifyQuery(query: string): QueryKind {
  const s = query.trim().toUpperCase();
  if (s === "<INSUFFICIENT PRIVILEGE>" || s === "") return "OTHER";
  if (s.startsWith("SELECT")) return "SELECT";
  if (s.startsWith("INSERT")) return "INSERT";
  if (s.startsWith("UPDATE")) return "UPDATE";
  if (s.startsWith("DELETE")) return "DELETE";
  if (DDL.test(s)) return "DDL";
  if (TX.test(s)) return "TRANSACTION";
  if (UTILITY.test(s)) return "UTILITY";
  return "OTHER";
}

/** Single-line preview of a normalized statement, whitespace-collapsed. */
export function previewSql(query: string, max = 110): string {
  const s = query.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Adaptive ms → ms / s / min / h. */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)} s`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(1)} min`;
  return `${(m / 60).toFixed(1)} h`;
}

export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return ms < 1 ? `${ms.toFixed(3)} ms` : `${ms.toFixed(ms < 100 ? 2 : 1)} ms`;
}

export function fmtPct(pct: number | null): string {
  return pct == null || !Number.isFinite(pct) ? "—" : `${pct.toFixed(1)}%`;
}

/** Share of total DB time taken by the #1 statement (0..100). */
export function topSharePct(snap: PgssSnapshot): number {
  const top = snap.statements[0];
  if (!top || snap.totals.totalExecMs <= 0) return 0;
  return (top.totalMs / snap.totals.totalExecMs) * 100;
}

/** Weighted shared-buffer hit ratio across the given rows (0..100), or null. */
export function overallHitPct(rows: StatementRow[]): number | null {
  let hit = 0;
  let total = 0;
  for (const r of rows) {
    hit += r.blksHit;
    total += r.blksHit + r.blksRead;
  }
  return total > 0 ? (hit / total) * 100 : null;
}

/** Mean execution time per call across the whole database, or null. */
export function avgPerCall(totals: PgssSnapshot["totals"]): number | null {
  return totals.totalCalls > 0 ? totals.totalExecMs / totals.totalCalls : null;
}

/** Compact "since reset" window label, e.g. "2d 4h", "37m". */
export function windowLabel(fromIso: string | null, toIso: string): string {
  if (!fromIso) return "—";
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return "—";
  const mins = Math.floor((to - from) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}
