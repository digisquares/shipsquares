import { useEffect, useState } from "react";

import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { Page } from "../components/page";
import { SkeletonRows } from "../components/skeleton";
import { StatusPill } from "../components/status-pill";
import { api } from "../lib/api";
import { pageTitle } from "../lib/page-title";
import { relativeTime } from "../lib/time";
import { toast } from "../lib/toast";
import { useResource } from "../lib/use-resource";

// Managed-DB backups overview (R5.3): each config's schedule + next run + the
// last run's status/size, the recent runs, and a run-now action. Read-mostly —
// configs are created via the API/CLI; this card surfaces + drives them.

interface LastRun {
  status: string;
  sizeBytes: number | null;
  finishedAt: string | null;
}
interface BackupConfig {
  id: string;
  serverId: string;
  databaseId: string | null;
  type: string;
  schedule: string;
  walArchive: boolean;
  keepNewest: number;
  retentionDays: number;
  enabled: boolean;
  lastWalAt: string | null;
  nextRunAt: string | null;
  lastRun: LastRun | null;
}
interface RunRow {
  id: string;
  status: string;
  sizeBytes: number | null;
  error: string | null;
  startedAt: string;
}

/** Human byte size for the backup artifact column. */
export function formatBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function Backups() {
  const {
    data: configs,
    loading,
    error,
    reload,
  } = useResource(() => api.get<BackupConfig[]>("/api/v1/backup-configs"));
  const [openRuns, setOpenRuns] = useState<Record<string, RunRow[] | "loading">>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    document.title = pageTitle("Backups");
  }, []);

  async function runNow(c: BackupConfig) {
    setBusy((b) => ({ ...b, [c.id]: true }));
    const path =
      c.type === "physical"
        ? `/api/v1/backup-configs/${c.id}/base-backup`
        : `/api/v1/backup-configs/${c.id}/run`;
    const r = await api.post(path);
    setBusy((b) => ({ ...b, [c.id]: false }));
    if (r.ok) {
      toast.success("Backup started");
      setTimeout(() => reload(), 2500);
    } else {
      toast.error(`Could not start backup (${r.status}).`);
    }
  }

  async function toggleRuns(id: string) {
    if (openRuns[id]) {
      setOpenRuns((o) => {
        const next = { ...o };
        delete next[id];
        return next;
      });
      return;
    }
    setOpenRuns((o) => ({ ...o, [id]: "loading" }));
    const r = await api.get<RunRow[]>(`/api/v1/backup-configs/${id}/runs`);
    setOpenRuns((o) => ({ ...o, [id]: r.ok && Array.isArray(r.data) ? r.data : [] }));
  }

  return (
    <Page
      title="Backups"
      subtitle="Scheduled database backups + point-in-time recovery — size, next run, and history."
    >
      <section className="card">
        <div className="card-head">
          <h2>Backup configs</h2>
        </div>

        {loading && !configs ? (
          <SkeletonRows count={3} />
        ) : error ? (
          <ErrorState title="Couldn't load backups" message={error} onRetry={reload} />
        ) : configs && configs.length > 0 ? (
          <ul className="backup-list">
            {configs.map((c) => {
              const runs = openRuns[c.id];
              return (
                <li key={c.id} className="backup-item">
                  <div className="backup-top">
                    <span className="pill pill-neutral">
                      {c.type === "physical" ? "PITR" : "logical"}
                    </span>
                    <span className="app-name mono">{c.databaseId ?? c.serverId}</span>
                    {c.walArchive && (
                      <span className="muted mono" title="continuous WAL archiving">
                        WAL
                      </span>
                    )}
                    {!c.enabled && (
                      <span className="muted" title="schedule paused">
                        paused
                      </span>
                    )}
                    <span className="backup-sched muted mono" title="schedule (cron, UTC)">
                      {c.schedule}
                    </span>
                    {c.nextRunAt && (
                      <span className="muted" title={new Date(c.nextRunAt).toLocaleString()}>
                        next {relativeTime(c.nextRunAt)}
                      </span>
                    )}
                    <span className="backup-spacer" />
                    {c.lastRun ? (
                      <>
                        <StatusPill status={c.lastRun.status} />
                        <span className="muted mono">{formatBytes(c.lastRun.sizeBytes)}</span>
                        {c.lastRun.finishedAt && (
                          <span className="muted">{relativeTime(c.lastRun.finishedAt)}</span>
                        )}
                      </>
                    ) : (
                      <span className="muted">no runs yet</span>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => void toggleRuns(c.id)}>
                      {runs ? "Hide" : "Runs"}
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void runNow(c)}
                      disabled={!!busy[c.id] || !c.enabled}
                      title={c.enabled ? "Run a backup now" : "Config is paused"}
                    >
                      {busy[c.id] ? "Starting…" : "Run now"}
                    </button>
                  </div>
                  <div className="backup-keep muted">
                    keep {c.keepNewest} ∪ {c.retentionDays}d
                  </div>
                  {runs && (
                    <ul className="backup-runs">
                      {runs === "loading" ? (
                        <li className="muted">Loading…</li>
                      ) : runs.length === 0 ? (
                        <li className="muted">No runs yet.</li>
                      ) : (
                        runs.map((run) => (
                          <li key={run.id} className="backup-run">
                            <StatusPill status={run.status} />
                            <span className="muted mono">{formatBytes(run.sizeBytes)}</span>
                            <span className="muted">{relativeTime(run.startedAt)}</span>
                            {run.error && (
                              <span className="field-error" title={run.error}>
                                {run.error.slice(0, 80)}
                              </span>
                            )}
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            title="No backup configs"
            description="Schedule database backups via the API or CLI; they'll show here."
          />
        )}
      </section>
    </Page>
  );
}
