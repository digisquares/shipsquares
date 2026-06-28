import { useCallback, useEffect, useState } from "react";

import { CopyButton } from "../components/copy-button";
import { EmptyState } from "../components/empty-state";
import { Page } from "../components/page";
import { SkeletonRows } from "../components/skeleton";
import { api } from "../lib/api";
import {
  type PgssSnapshot,
  type QueryKind,
  type StatementRow,
  avgPerCall,
  classifyQuery,
  fmtDuration,
  fmtInt,
  fmtMs,
  fmtPct,
  overallHitPct,
  previewSql,
  topSharePct,
  windowLabel,
} from "../lib/db-perf";
import { pageTitle } from "../lib/page-title";
import { toast } from "../lib/toast";

// DB Performance (docs/db-performance.md): live pg_stat_statements for a managed
// Postgres server — KPI cards, the hottest statements, and a per-statement
// detail panel. Reads GET /database-servers/:id/pg-stat-statements and resets via
// POST …/reset (server:write). Query text is normalized, so no row data shows.

interface ServerView {
  id: string;
  engine: string;
  host: string;
  port: number;
  isDefault: boolean;
  tls: boolean;
}

// Statement kind → pill tone (reuses the shared pill palette).
const KIND_PILL: Record<QueryKind, string> = {
  SELECT: "pill-info",
  INSERT: "pill-ok",
  UPDATE: "pill-warn",
  DELETE: "pill-fail",
  DDL: "pill-neutral",
  TRANSACTION: "pill-neutral",
  UTILITY: "pill-neutral",
  OTHER: "pill-neutral",
};

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="metric">
      <div className="metric-head">
        <span className="muted">{label}</span>
      </div>
      <span className="mono kpi-value">{value}</span>
      {hint ? <p className="muted dbperf-hint">{hint}</p> : null}
    </div>
  );
}

function errorDetail(data: unknown, status: number): string {
  const detail = (data as { detail?: string } | null)?.detail;
  return detail ?? `Request failed (${status}).`;
}

export function DbPerformance() {
  const [servers, setServers] = useState<ServerView[] | null>(null);
  const [serverId, setServerId] = useState<string>("");
  const [snap, setSnap] = useState<PgssSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [selected, setSelected] = useState<StatementRow | null>(null);

  useEffect(() => {
    document.title = pageTitle("DB Performance");
  }, []);

  // Load the managed servers and default the selection to is_default / first.
  useEffect(() => {
    let alive = true;
    void api.get<ServerView[]>("/api/v1/database-servers").then((r) => {
      if (!alive) return;
      const list = r.ok ? (r.data ?? []) : [];
      setServers(list);
      setServerId((cur) => cur || list.find((s) => s.isDefault)?.id || list[0]?.id || "");
    });
    return () => {
      alive = false;
    };
  }, []);

  const loadSnapshot = useCallback(async (id: string, refresh = false) => {
    if (!id) return;
    if (refresh) setBusy(true);
    else setLoading(true);
    const r = await api.get<PgssSnapshot>(
      `/api/v1/database-servers/${id}/pg-stat-statements?limit=50`,
    );
    if (r.ok) {
      setSnap(r.data);
      setSelected(null);
      setError("");
    } else {
      setSnap(null);
      setError(errorDetail(r.data, r.status));
    }
    setLoading(false);
    setBusy(false);
  }, []);

  // Reload whenever the selected server changes.
  useEffect(() => {
    if (serverId) void loadSnapshot(serverId);
  }, [serverId, loadSnapshot]);

  async function doReset() {
    if (!serverId) return;
    setBusy(true);
    const r = await api.post<PgssSnapshot>(
      `/api/v1/database-servers/${serverId}/pg-stat-statements/reset?limit=50`,
    );
    setBusy(false);
    if (r.ok) {
      setSnap(r.data);
      setSelected(null);
      setError("");
      toast.success("pg_stat_statements counters reset");
    } else {
      toast.error(errorDetail(r.data, r.status));
    }
  }

  const rows = snap?.statements ?? [];
  const actions = (
    <div className="page-actions">
      {servers && servers.length > 0 && (
        <select
          aria-label="Server"
          value={serverId}
          onChange={(e) => setServerId(e.target.value)}
          disabled={busy || loading}
        >
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.host}:{s.port}
              {s.isDefault ? " (default)" : ""}
            </option>
          ))}
        </select>
      )}
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => void loadSnapshot(serverId, true)}
        disabled={!serverId || busy || loading}
      >
        {busy ? "Refreshing…" : "Refresh"}
      </button>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => void doReset()}
        disabled={!serverId || busy || loading || !snap}
      >
        Reset stats
      </button>
    </div>
  );

  return (
    <Page
      title="DB Performance"
      subtitle="Live pg_stat_statements for a managed Postgres server — query shapes and timings only."
      width="wide"
      actions={actions}
    >
      {servers === null ? (
        <section className="card">
          <SkeletonRows count={3} />
        </section>
      ) : servers.length === 0 ? (
        <EmptyState
          title="No managed servers yet"
          description="Register a Postgres server (POST /api/v1/database-servers or the CLI) to see its query performance here."
        />
      ) : loading ? (
        <section className="card">
          <SkeletonRows count={6} />
        </section>
      ) : error ? (
        <EmptyState
          title="Couldn't load performance stats"
          description={error}
          action={
            <button
              className="btn btn-primary btn-sm"
              onClick={() => void loadSnapshot(serverId, true)}
            >
              Retry
            </button>
          }
        />
      ) : snap ? (
        <>
          <p className="muted dbperf-meta">
            PostgreSQL {snap.serverVersion.split(" ")[0]} · {snap.totals.distinctStatements}{" "}
            statements tracked · window {windowLabel(snap.statsReset, snap.capturedAt)} · captured{" "}
            {new Date(snap.capturedAt).toLocaleString()}
          </p>

          <div className="metrics-grid dbperf-kpis">
            <Kpi label="Total DB time" value={fmtDuration(snap.totals.totalExecMs)} />
            <Kpi label="Top query share" value={fmtPct(topSharePct(snap))} />
            <Kpi label="Total calls" value={fmtInt(snap.totals.totalCalls)} />
            <Kpi
              label="Avg time / call"
              value={(() => {
                const a = avgPerCall(snap.totals);
                return a == null ? "—" : fmtMs(a);
              })()}
            />
            <Kpi label="Distinct statements" value={fmtInt(snap.totals.distinctStatements)} />
            <Kpi
              label="Cache hit (top 50)"
              value={fmtPct(overallHitPct(rows))}
              hint="shared-buffer hits → CPU-bound, not I/O"
            />
          </div>

          <section className="card">
            <div className="card-head">
              <h2>Top statements by total time</h2>
            </div>
            {rows.length === 0 ? (
              <EmptyState
                title="No statements recorded yet"
                description="pg_stat_statements is enabled but hasn't captured queries since the last reset."
              />
            ) : (
              <ul className="app-list">
                {rows.map((r) => {
                  const kind = classifyQuery(r.query);
                  return (
                    <li key={`${r.rank}-${r.queryid}`} className="app-row">
                      <span className="muted mono" style={{ width: "2.5ch", textAlign: "right" }}>
                        {r.rank}
                      </span>
                      <span className={`pill ${KIND_PILL[kind]}`}>{kind}</span>
                      <span className="app-name mono dbperf-query" title={r.query}>
                        {previewSql(r.query, 80)}
                      </span>
                      <span className="muted mono" title="database">
                        {r.database || "—"}
                      </span>
                      <span className="muted mono" title="calls">
                        {fmtInt(r.calls)} calls
                      </span>
                      <span className="mono" title="total time">
                        {fmtDuration(r.totalMs)}
                      </span>
                      <span className="muted mono" title="mean / call">
                        {fmtMs(r.meanMs)}
                      </span>
                      <span className="muted mono" title="cache hit">
                        {fmtPct(r.hitPct)}
                      </span>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSelected(r)}
                        aria-label={`Inspect statement #${r.rank}`}
                      >
                        Details
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {selected && (
            <section className="card">
              <div className="card-head">
                <h2>Statement #{selected.rank}</h2>
                <div className="lc-actions">
                  <span className={`pill ${KIND_PILL[classifyQuery(selected.query)]}`}>
                    {classifyQuery(selected.query)}
                  </span>
                  <CopyButton text={selected.query} what="SQL" />
                  <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>
                    Close
                  </button>
                </div>
              </div>
              <div className="metrics-grid dbperf-detail-grid">
                <Kpi label="Calls" value={fmtInt(selected.calls)} />
                <Kpi label="Total time" value={fmtDuration(selected.totalMs)} />
                <Kpi label="Mean / call" value={fmtMs(selected.meanMs)} />
                <Kpi label="Min / call" value={fmtMs(selected.minMs)} />
                <Kpi label="Max / call" value={fmtMs(selected.maxMs)} />
                <Kpi label="Std dev" value={fmtMs(selected.stddevMs)} />
                <Kpi label="Rows total" value={fmtInt(selected.rows)} />
                <Kpi label="Cache hit" value={fmtPct(selected.hitPct)} />
                <Kpi label="Shared blks hit" value={fmtInt(selected.blksHit)} />
                <Kpi label="Shared blks read" value={fmtInt(selected.blksRead)} />
              </div>
              <p className="muted dbperf-hint">
                Normalized SQL — literals are parameterized ($1, $2 …), so no row data is shown.
              </p>
              <pre className="log-console">{selected.query}</pre>
            </section>
          )}
        </>
      ) : null}
    </Page>
  );
}
