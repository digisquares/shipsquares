import { useEffect, useState } from "react";

import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { Page } from "../components/page";
import { SkeletonRows } from "../components/skeleton";
import { StatusPill } from "../components/status-pill";
import { api } from "../lib/api";
import { pageTitle } from "../lib/page-title";
import type { Tone } from "../lib/status";
import { toast } from "../lib/toast";
import { useResource } from "../lib/use-resource";

interface ServerRow {
  id: string;
  name: string;
  host: string;
  role: "control" | "worker";
  status: string;
  dockerOk: boolean;
  caddyOk: boolean;
  createdAt: string;
}

// Server FSM (servers.ts) → pill tone. "ready" is healthy; adding/bootstrapping
// are in-flight; error/unreachable are failures.
const TONE: Record<string, Tone> = {
  ready: "ok",
  bootstrapping: "warn",
  adding: "neutral",
  error: "fail",
  unreachable: "fail",
};

// Servers (docs/web-ui/01, §3 Platform — previously had no route). Control +
// worker nodes with health, Docker and proxy status, and a re-check action.
export function Servers() {
  const {
    data: servers,
    loading,
    error,
    reload,
  } = useResource(() => api.get<{ data: ServerRow[] }>("/api/v1/servers"));
  const [checking, setChecking] = useState<Record<string, boolean>>({});

  useEffect(() => {
    document.title = pageTitle("Servers");
  }, []);

  async function check(id: string) {
    setChecking((c) => ({ ...c, [id]: true }));
    const r = await api.post(`/api/v1/servers/${id}/check`);
    setChecking((c) => ({ ...c, [id]: false }));
    if (r.ok) {
      toast.success("Health check queued");
      setTimeout(() => reload(), 1500);
    } else {
      toast.error(`Check failed (${r.status}).`);
    }
  }

  return (
    <Page title="Servers" subtitle="Control and worker nodes — health, Docker and proxy status.">
      <section className="card">
        <div className="card-head">
          <h2>Servers</h2>
        </div>
        {loading && !servers ? (
          <SkeletonRows count={3} />
        ) : error ? (
          <ErrorState title="Couldn't load servers" message={error} onRetry={reload} />
        ) : servers && servers.data.length > 0 ? (
          <ul className="app-list">
            {servers.data.map((s) => (
              <li key={s.id} className="app-row">
                <span className="app-name">{s.name}</span>
                <span className="muted mono">{s.host}</span>
                <span className="pill pill-neutral">{s.role}</span>
                <StatusPill status={s.status} tone={TONE[s.status] ?? "neutral"} label={s.status} />
                <span className="muted app-id" title="Docker daemon reachable">
                  {s.dockerOk ? "docker ok" : "docker down"}
                </span>
                <span className="muted" title="Reverse proxy reachable">
                  {s.caddyOk ? "proxy ok" : "proxy down"}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => void check(s.id)}
                  disabled={!!checking[s.id]}
                  aria-label={`Re-check ${s.name}`}
                >
                  {checking[s.id] ? "Checking…" : "Check"}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No servers yet"
            description="Add a worker server via the API or CLI to scale out deploys."
          />
        )}
      </section>
    </Page>
  );
}
