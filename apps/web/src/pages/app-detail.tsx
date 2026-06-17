import { type FormEvent, useCallback, useEffect, useState } from "react";

import { BuildSettingsCard } from "../components/build-settings-card";
import { Console } from "../components/console";
import { CopyButton } from "../components/copy-button";
import { DeployTimeline } from "../components/deploy-timeline";
import { EmptyState } from "../components/empty-state";
import { LogViewer } from "../components/log-viewer";
import { MetricChart } from "../components/metric-chart";
import { SchedulesCard } from "../components/schedules-card";
import { Sparkline } from "../components/sparkline";
import { StatusPill } from "../components/status-pill";
import { UserMenu } from "../components/user-menu";
import { api } from "../lib/api";
import { confirm } from "../lib/confirm";
import type { ApiStep } from "../lib/deploy-timeline";
import { pageTitle } from "../lib/page-title";
import { relativeTime } from "../lib/time";
import { toast } from "../lib/toast";
import { wsUrl } from "../lib/ws";

interface AppT {
  id: string;
  name: string;
  repo: string | null;
  image: string | null;
  branch: string;
  port: number;
  cpu: number | null;
  memoryMb: number | null;
  buildStrategy: string;
}
interface DeploymentT {
  id: string;
  status: string;
  trigger: string;
  commitAfter: string | null;
  errorMessage: string | null;
  queuedAt: string;
  meta: { url?: string; container?: string } | null;
}
interface LogLine {
  seq: number;
  stream: string;
  line: string;
}
interface RuntimeLogLine {
  stream: string;
  line: string;
  ts?: string;
}
interface EnvRow {
  key: string;
  value: string;
  isSecret: boolean;
  existingSecret: boolean;
}
interface DomainT {
  id: string;
  fqdn: string;
  certStatus: string;
}
interface WebhookT {
  id: string;
  url: string;
  provider: string;
  secret?: string;
}
interface Page<T> {
  data: T[];
}
interface Metrics {
  running: boolean;
  cpuPercent?: number;
  memPercent?: number;
  memUsage?: string;
}

export function AppDetail({ appId }: { appId: string }) {
  const [app, setApp] = useState<AppT | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [deploys, setDeploys] = useState<DeploymentT[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [steps, setSteps] = useState<ApiStep[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [env, setEnv] = useState<EnvRow[]>([]);
  const [envMsg, setEnvMsg] = useState("");
  const [domains, setDomains] = useState<DomainT[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [webhook, setWebhook] = useState<WebhookT | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const [memHist, setMemHist] = useState<number[]>([]);
  const [lcBusy, setLcBusy] = useState(false);
  const [lcMsg, setLcMsg] = useState("");
  const [runtimeLogs, setRuntimeLogs] = useState<RuntimeLogLine[]>([]);
  const [runtimeNote, setRuntimeNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  // console target = the latest succeeded deployment's container (exact name)
  const consoleTarget =
    deploys.find((d) => d.status === "succeeded" && d.meta?.container)?.meta?.container ?? null;

  // poll live container metrics → rolling sparkline buffers. The chain always
  // reschedules (a blip must not kill polling) and the pending timer is cleared
  // on unmount so no tick fires after an app switch.
  useEffect(() => {
    if (loadFailed) return; // don't 404-poll an app that doesn't exist
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await api.get<Metrics>(`/api/v1/apps/${appId}/metrics`);
        if (stop) return;
        if (r.ok) {
          setMetrics(r.data);
          if (r.data.running) {
            setCpuHist((h) => [...h, r.data.cpuPercent ?? 0].slice(-40));
            setMemHist((h) => [...h, r.data.memPercent ?? 0].slice(-40));
          }
        }
      } catch {
        /* keep polling through transient failures */
      }
      if (!stop) timer = setTimeout(() => void tick(), 3000);
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [appId, loadFailed]);

  const loadDeploys = useCallback(async () => {
    const r = await api.get<Page<DeploymentT>>(`/api/v1/apps/${appId}/deployments`);
    if (r.ok) {
      setDeploys(r.data.data);
      setSelected((cur) => cur ?? r.data.data[0]?.id ?? null);
    }
  }, [appId]);

  const loadAll = useCallback(async () => {
    const [a, e, d, w] = await Promise.all([
      api.get<AppT>(`/api/v1/apps/${appId}`),
      api.get<{ key: string; value: string | null; isSecret: boolean }[]>(
        `/api/v1/apps/${appId}/env`,
      ),
      api.get<DomainT[]>(`/api/v1/apps/${appId}/domains`),
      api.get<WebhookT>(`/api/v1/apps/${appId}/webhook`),
    ]);
    if (a.ok) setApp(a.data);
    else setLoadFailed(true); // deleted app / stale link — never an eternal spinner

    if (e.ok)
      setEnv(
        e.data.map((v) => ({
          key: v.key,
          value: v.isSecret ? "" : (v.value ?? ""),
          isSecret: v.isSecret,
          existingSecret: v.isSecret,
        })),
      );
    if (d.ok) setDomains(d.data);
    setWebhook(w.ok ? w.data : null);
    await loadDeploys();
  }, [appId, loadDeploys]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Recorded pipeline steps for the selected deployment — fetched once for
  // terminal rows, polled while the pipeline is still moving (the WS pushes
  // status flips, but step transitions only live in the steps API).
  const selectedStatus = deploys.find((d) => d.id === selected)?.status;
  useEffect(() => {
    if (!selected) {
      setSteps([]);
      return;
    }
    let alive = true;
    const fetchSteps = async () => {
      const r = await api.get<ApiStep[]>(`/api/v1/deployments/${selected}/steps`);
      if (alive && r.ok) setSteps(r.data);
    };
    setSteps([]);
    void fetchSteps();
    const moving = selectedStatus === "queued" || selectedStatus === "running";
    const timer = moving ? setInterval(() => void fetchSteps(), 2000) : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [selected, selectedStatus]);

  // live logs over WebSocket: subscribe → replay (existing tail) → live frames
  useEffect(() => {
    if (!selected) return;
    setLogs([]);
    const ws = new WebSocket(wsUrl("/api/v1/ws"));
    ws.onopen = () =>
      ws.send(JSON.stringify({ type: "subscribe", topic: `deployment:${selected}` }));
    ws.onmessage = (e) => {
      let msg: { type: string; lines?: LogLine[]; line?: LogLine };
      try {
        msg = JSON.parse(String(e.data)) as typeof msg;
      } catch {
        return;
      }
      if (msg.type === "replay" && msg.lines) setLogs(msg.lines);
      else if (msg.type === "log" && msg.line) {
        const ln = msg.line;
        setLogs((prev) => [...prev, ln]);
      } else if (msg.type === "deployment") void loadDeploys();
    };
    return () => ws.close();
  }, [selected, loadDeploys]);

  // live RUNTIME logs (the running container's stdout/stderr) over WebSocket,
  // independent of any deployment: subscribe app:<id> → live frames → ended.
  useEffect(() => {
    setRuntimeLogs([]);
    setRuntimeNote("");
    const ws = new WebSocket(wsUrl("/api/v1/ws"));
    ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", topic: `app:${appId}` }));
    ws.onmessage = (e) => {
      let msg: { type: string; line?: RuntimeLogLine; code?: string };
      try {
        msg = JSON.parse(String(e.data)) as typeof msg;
      } catch {
        return;
      }
      if (msg.type === "log" && msg.line) {
        const ln = msg.line;
        setRuntimeLogs((prev) => [...prev, ln].slice(-1000));
      } else if (msg.type === "ended") setRuntimeNote("— stream ended (container stopped) —");
      else if (msg.type === "error" && msg.code === "not_running")
        setRuntimeNote("App is not running.");
    };
    return () => ws.close();
  }, [appId]);

  // Reflect the current app in the browser tab; restore on leave.
  useEffect(() => {
    document.title = pageTitle(app?.name ?? "App");
    return () => {
      document.title = pageTitle();
    };
  }, [app?.name]);

  async function deploy() {
    setBusy(true);
    const r = await api.post<{ id: string }>(`/api/v1/apps/${appId}/deployments`);
    setBusy(false);
    if (r.ok) {
      await loadDeploys();
      setSelected(r.data.id);
      setLogs([]);
      toast.success("Deploy queued");
    } else {
      toast.error(`Deploy failed (${r.status})`);
    }
  }

  async function rollback(depId: string) {
    const r = await api.post<{ id: string }>(`/api/v1/deployments/${depId}/rollback`);
    if (r.ok) {
      await loadDeploys();
      setSelected(r.data.id);
      setLogs([]);
      toast.success("Rollback queued");
    } else {
      toast.error(`Rollback failed (${r.status})`);
    }
  }

  // stop / start / restart the running container (no rebuild); the response is
  // the resulting live metrics, so the card flips running/stopped immediately.
  async function lifecycle(action: "start" | "stop" | "restart") {
    setLcBusy(true);
    setLcMsg("");
    const r = await api.post<Metrics>(`/api/v1/apps/${appId}/${action}`);
    setLcBusy(false);
    if (r.ok) {
      setMetrics(r.data);
      if (!r.data.running) {
        setCpuHist([]);
        setMemHist([]);
      }
      toast.success(
        `Container ${{ start: "started", stop: "stopped", restart: "restarted" }[action]}`,
      );
    } else {
      const d = r.data as { detail?: string } | null;
      const msg = d?.detail ?? `${action} failed (${r.status})`;
      setLcMsg(msg);
      toast.error(msg);
    }
  }

  async function saveEnv(e: FormEvent) {
    e.preventDefault();
    setEnvMsg("");
    const vars = env
      .filter((r) => r.key.trim())
      .map((r) => ({ key: r.key.trim(), value: r.value, isSecret: r.isSecret }));
    const r = await api.put<unknown>(`/api/v1/apps/${appId}/env`, { vars });
    if (r.ok) {
      setEnvMsg("Saved. Redeploy to apply.");
      await loadAll();
      toast.success("Environment saved");
    } else {
      const d = r.data as { detail?: string } | null;
      const msg = d?.detail ?? `Save failed (${r.status})`;
      setEnvMsg(msg);
      toast.error(msg);
    }
  }

  async function addDomain(e: FormEvent) {
    e.preventDefault();
    if (!newDomain.trim()) return;
    const r = await api.post(`/api/v1/apps/${appId}/domains`, { fqdn: newDomain.trim() });
    if (r.ok) {
      setNewDomain("");
      const d = await api.get<DomainT[]>(`/api/v1/apps/${appId}/domains`);
      if (d.ok) setDomains(d.data);
      toast.success("Domain added");
    } else {
      const d = r.data as { detail?: string } | null;
      toast.error(d?.detail ?? `Add failed (${r.status})`);
    }
  }

  async function removeDomain(id: string) {
    await api.del(`/api/v1/domains/${id}`);
    setDomains((ds) => ds.filter((x) => x.id !== id));
    toast.success("Domain removed");
  }

  async function createWebhook() {
    const r = await api.post<WebhookT>(`/api/v1/apps/${appId}/webhook`, {});
    if (r.ok) setWebhook(r.data);
  }

  if (!app) {
    return (
      <div className="center-screen">
        {loadFailed ? (
          <div className="empty">
            <h2>App not found</h2>
            <p className="muted">It may have been deleted, or this link is stale.</p>
            <a className="btn btn-primary btn-sm" href="#/">
              Back to dashboard
            </a>
          </div>
        ) : (
          <div className="spinner" aria-label="Loading" />
        )}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <a href="#/" className="back-link">
            ←
          </a>
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">{app.name}</span>
          {app.repo && <span className="muted mono">{app.branch}</span>}
        </div>
        <div className="topbar-right">
          <UserMenu />
        </div>
      </header>

      <main className="page">
        <div className="page-head">
          <nav className="crumbs" aria-label="Breadcrumb">
            <a href="#/">Dashboard</a>
            <span className="crumbs-sep" aria-hidden>
              /
            </span>
            <span aria-current="page">{app.name}</span>
          </nav>
          <h1>{app.name}</h1>
          <p className="muted mono">
            {app.repo ?? (app.image ? `image: ${app.image}` : "no source")} · port {app.port}
            {app.cpu != null && ` · ${app.cpu} cpu`}
            {app.memoryMb != null && ` · ${app.memoryMb} MB`}
          </p>
        </div>

        {/* Live resource metrics + lifecycle controls */}
        <section className="card">
          <div className="card-head">
            <h2>Live metrics</h2>
            <div className="lc-actions">
              <StatusPill
                status={metrics?.running ? "running" : "stopped"}
                tone={metrics?.running ? "ok" : "neutral"}
                label={metrics ? (metrics.running ? "running" : "stopped") : "…"}
              />
              {metrics &&
                (metrics.running ? (
                  <>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => void lifecycle("restart")}
                      disabled={lcBusy}
                    >
                      Restart
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => void lifecycle("stop")}
                      disabled={lcBusy}
                    >
                      Stop
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void lifecycle("start")}
                    disabled={lcBusy}
                  >
                    Start
                  </button>
                ))}
            </div>
          </div>
          {lcMsg && <p className="muted">{lcMsg}</p>}
          {metrics?.running ? (
            <div className="metrics-grid">
              <div className="metric">
                <div className="metric-head">
                  <span className="muted">CPU</span>
                  <span className="mono">{(metrics.cpuPercent ?? 0).toFixed(1)}%</span>
                </div>
                <Sparkline data={cpuHist} color="#4ade80" />
              </div>
              <div className="metric">
                <div className="metric-head">
                  <span className="muted">Memory</span>
                  <span className="mono">
                    {(metrics.memPercent ?? 0).toFixed(1)}%
                    {metrics.memUsage ? ` · ${metrics.memUsage}` : ""}
                  </span>
                </div>
                <Sparkline data={memHist} color="#60a5fa" />
              </div>
            </div>
          ) : (
            <p className="muted">No running container.</p>
          )}
          {/* Historical series from the collector (1-min samples, bucketed) */}
          <MetricChart appId={appId} />
        </section>

        <BuildSettingsCard appId={appId} />

        <SchedulesCard appId={appId} />

        {/* Runtime logs (the running container's stdout/stderr, live) */}
        <section className="card">
          <div className="card-head">
            <h2>Runtime logs</h2>
            {runtimeNote && <span className="muted mono">{runtimeNote}</span>}
          </div>
          <LogViewer lines={runtimeLogs} emptyText={runtimeNote || "Waiting for output…"} />
        </section>

        {/* Interactive console (exec into the running container) */}
        <section className="card">
          <div className="card-head">
            <h2>Console</h2>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowConsole((v) => !v)}
              disabled={!consoleTarget}
              title={consoleTarget ? "" : "Needs a succeeded deployment"}
            >
              {showConsole ? "Close" : "Open console"}
            </button>
          </div>
          {showConsole && consoleTarget ? (
            <Console target={consoleTarget} />
          ) : (
            <p className="muted">
              {consoleTarget
                ? "Opens a shell in the running container (sh)."
                : "Deploy first — the console attaches to the running container."}
            </p>
          )}
        </section>

        {/* Deployments + logs */}
        <section className="card">
          <div className="card-head">
            <h2>Deployments</h2>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => void deploy()}
              disabled={busy || (!app.repo && !app.image)}
            >
              {busy ? "Deploying…" : "Deploy"}
            </button>
          </div>
          {deploys.length === 0 ? (
            <EmptyState
              title="No deployments yet"
              description="Trigger a deploy to see build logs and live status here."
              action={
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => void deploy()}
                  disabled={busy || (!app.repo && !app.image)}
                >
                  {busy ? "Deploying…" : "Deploy"}
                </button>
              }
            />
          ) : (
            <ul className="dep-list">
              {deploys.map((d) => (
                <li key={d.id} className={`dep-row${d.id === selected ? " sel" : ""}`}>
                  <button
                    type="button"
                    className="dep-row-select"
                    aria-pressed={d.id === selected}
                    onClick={() => setSelected(d.id)}
                  >
                    <StatusPill status={d.status} />
                    <span className="muted mono">{d.trigger}</span>
                    <span className="mono">{d.commitAfter?.slice(0, 7) ?? "—"}</span>
                    <span className="muted app-id" title={new Date(d.queuedAt).toLocaleString()}>
                      {relativeTime(d.queuedAt)}
                    </span>
                  </button>
                  {d.status === "succeeded" && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: "Roll back to this deployment?",
                            message: "This redeploys the selected build as the live version.",
                            confirmLabel: "Roll back",
                          })
                        )
                          void rollback(d.id);
                      }}
                    >
                      Rollback
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {selected && (
            <>
              {(() => {
                const sel = deploys.find((d) => d.id === selected);
                return sel ? <DeployTimeline status={sel.status} steps={steps} /> : null;
              })()}
              <LogViewer
                lines={logs.map((l) => ({ line: l.line, stream: l.stream, key: l.seq }))}
                emptyText="No logs."
              />
            </>
          )}
        </section>

        {/* Env */}
        <section className="card">
          <div className="card-head">
            <h2>Environment</h2>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() =>
                setEnv((rows) => [
                  ...rows,
                  { key: "", value: "", isSecret: false, existingSecret: false },
                ])
              }
            >
              + Add
            </button>
          </div>
          <form onSubmit={saveEnv}>
            {env.length === 0 && <p className="muted">No environment variables.</p>}
            {env.map((row, i) => (
              <div className="env-row" key={i}>
                <input
                  className="mono"
                  placeholder="KEY"
                  value={row.key}
                  onChange={(e) =>
                    setEnv((rows) =>
                      rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)),
                    )
                  }
                />
                <input
                  className="mono"
                  type={row.isSecret ? "password" : "text"}
                  placeholder={row.existingSecret ? "•••••• (unchanged)" : "value"}
                  value={row.value}
                  onChange={(e) =>
                    setEnv((rows) =>
                      rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)),
                    )
                  }
                />
                <label className="secret-toggle">
                  <input
                    type="checkbox"
                    checked={row.isSecret}
                    onChange={(e) =>
                      setEnv((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, isSecret: e.target.checked } : r)),
                      )
                    }
                  />
                  secret
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setEnv((rows) => rows.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="env-actions">
              <button className="btn btn-primary btn-sm" type="submit">
                Save environment
              </button>
              {envMsg && <span className="muted">{envMsg}</span>}
            </div>
          </form>
        </section>

        {/* Domains */}
        <section className="card">
          <div className="card-head">
            <h2>Domains</h2>
          </div>
          {domains.length === 0 ? (
            <EmptyState
              title="No domains"
              description="Add one above to serve this app over HTTPS."
            />
          ) : (
            <ul className="app-list">
              {domains.map((d) => (
                <li key={d.id} className="app-row">
                  <span className="mono">{d.fqdn}</span>
                  <StatusPill status={d.certStatus} />
                  <button
                    className="btn btn-ghost btn-sm app-id"
                    aria-label={`Remove ${d.fqdn}`}
                    onClick={async () => {
                      if (await confirm({ title: "Remove domain?", message: d.fqdn, danger: true }))
                        void removeDomain(d.id);
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form className="new-app" onSubmit={addDomain}>
            <input
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="app.example.com"
            />
            <button className="btn btn-primary btn-sm" type="submit">
              Add domain
            </button>
          </form>
        </section>

        {/* Webhook */}
        <section className="card">
          <div className="card-head">
            <h2>Auto-deploy webhook</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => void createWebhook()}>
              {webhook ? "Rotate" : "Create"}
            </button>
          </div>
          {webhook ? (
            <div>
              <p className="muted">
                Add this as a {webhook.provider} webhook (push events, content-type
                application/json). A matching push redeploys automatically.
              </p>
              <div className="kv">
                <span className="muted">URL</span>
                <code className="mono">{webhook.url}</code>
                <CopyButton text={webhook.url} what="webhook URL" />
              </div>
              {webhook.secret && (
                <div className="kv">
                  <span className="muted">Secret (shown once)</span>
                  <code className="mono">{webhook.secret}</code>
                  <CopyButton text={webhook.secret} what="secret" />
                </div>
              )}
            </div>
          ) : (
            <p className="muted">No webhook yet. Create one to deploy on git push.</p>
          )}
        </section>
      </main>
    </div>
  );
}
