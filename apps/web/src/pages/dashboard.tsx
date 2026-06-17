import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { EmptyState } from "../components/empty-state";
import { Onboarding } from "../components/onboarding";
import { RepoPicker } from "../components/repo-picker";
import { SkeletonRows } from "../components/skeleton";
import { StatusPill } from "../components/status-pill";
import { UserMenu } from "../components/user-menu";
import { api } from "../lib/api";
import { confirm } from "../lib/confirm";
import { onboardingComplete, type OnboardingState } from "../lib/onboarding";
import { pageTitle } from "../lib/page-title";
import { toast } from "../lib/toast";
import { slugifyAppName, validateAppName } from "../lib/validate";
import { parseWsFrame, wsUrl } from "../lib/ws";

interface AppRow {
  id: string;
  name: string;
  branch?: string;
  repo?: string | null;
  image?: string | null;
}

interface DeployState {
  status: string;
}

interface Page<T> {
  data: T[];
}

export function Dashboard() {
  const [apps, setApps] = useState<AppRow[] | null>(null);
  const [deploys, setDeploys] = useState<Record<string, DeployState>>({});
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRepo, setNewRepo] = useState("");
  const [newImage, setNewImage] = useState("");
  const [newPort, setNewPort] = useState("");
  const [newCpu, setNewCpu] = useState("");
  const [newMem, setNewMem] = useState("");
  const [newVcsConnectionId, setNewVcsConnectionId] = useState("");

  const setDeploy = (appId: string, status: string) =>
    setDeploys((s) => ({ ...s, [appId]: { status } }));

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/apps", { credentials: "include" });
      if (!r.ok) {
        setNote(`Apps API responded ${r.status}.`);
        return;
      }
      const body = (await r.json()) as Page<AppRow>;
      const list = body.data ?? [];
      setApps(list);
      setNote("");
      // latest deployment status per app
      for (const a of list) {
        void fetch(`/api/v1/apps/${a.id}/deployments?limit=1`, { credentials: "include" })
          .then((res) => (res.ok ? (res.json() as Promise<Page<{ status: string }>>) : null))
          .then((p) => {
            const d = p?.data?.[0];
            if (d) setDeploy(a.id, d.status);
          });
      }
    } catch {
      setNote("Apps API unreachable.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    document.title = pageTitle("Dashboard");
  }, []);

  // The ⌘K palette's "New app" action opens this form (components/command-palette).
  useEffect(() => {
    const onNew = () => setShowNew(true);
    window.addEventListener("ss:new-app", onNew);
    return () => window.removeEventListener("ss:new-app", onNew);
  }, []);

  // Live deploy status over WebSocket — no polling (12-realtime-logs.md). The
  // server pushes a `deployment` frame on each status transition (and at once if
  // already terminal); we close on a terminal status or a 10-minute safety cap.
  // Sockets are tied to the component lifetime, and a drop mid-deploy re-checks
  // the status once so a row never freezes at "Deploying…".
  const socketsRef = useRef<Set<WebSocket>>(new Set());
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
      for (const ws of socketsRef.current) ws.close();
      socketsRef.current.clear();
    },
    [],
  );

  async function refreshDeployStatus(appId: string) {
    const r = await api.get<Page<{ status: string }>>(`/api/v1/apps/${appId}/deployments?limit=1`);
    const status = r.ok ? r.data?.data?.[0]?.status : undefined;
    if (mountedRef.current && status) setDeploy(appId, status);
  }

  function watchDeploy(appId: string, deployId: string) {
    const ws = new WebSocket(wsUrl("/api/v1/ws"));
    socketsRef.current.add(ws);
    let terminal = false;
    const safety = setTimeout(() => ws.close(), 10 * 60 * 1000);
    ws.onopen = () =>
      ws.send(JSON.stringify({ type: "subscribe", topic: `deployment:${deployId}` }));
    ws.onmessage = (e) => {
      const f = parseWsFrame(String(e.data));
      if (!f || f.type !== "deployment") return;
      const status = (f.deployment as { status?: string } | undefined)?.status;
      if (!status) return;
      if (mountedRef.current) setDeploy(appId, status);
      if (status === "succeeded" || status === "failed") {
        terminal = true;
        ws.close();
      }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      clearTimeout(safety);
      socketsRef.current.delete(ws);
      if (!terminal && mountedRef.current) void refreshDeployStatus(appId);
    };
  }

  async function deploy(appId: string) {
    setDeploy(appId, "queued");
    const r = await api.post<{ id: string }>(`/api/v1/apps/${appId}/deployments`);
    if (r.ok && r.data) watchDeploy(appId, r.data.id);
    else setDeploy(appId, r.status === 409 ? "running" : "failed");
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (validateAppName(name)) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/apps", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          ...(newRepo.trim() ? { repo: newRepo.trim() } : {}),
          ...(newImage.trim() ? { image: newImage.trim() } : {}),
          ...(newPort.trim() ? { port: Number(newPort.trim()) } : {}),
          ...(newCpu.trim() ? { cpu: Number(newCpu.trim()) } : {}),
          ...(newMem.trim() ? { memoryMb: Number(newMem.trim()) } : {}),
          ...(newVcsConnectionId ? { vcsConnectionId: newVcsConnectionId } : {}),
        }),
      });
      if (res.ok) {
        setNewName("");
        setNewRepo("");
        setNewImage("");
        setNewPort("");
        setNewCpu("");
        setNewMem("");
        setNewVcsConnectionId("");
        setShowNew(false);
        await load();
        toast.success(`Created “${name}”`);
      } else {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        const detail = body.detail ?? `Create failed (${res.status}).`;
        setNote(detail);
        toast.error(detail);
      }
    } finally {
      setCreating(false);
    }
  }

  const onboarding: OnboardingState = {
    hasApp: !!apps && apps.length > 0,
    hasDeployable: !!apps && apps.some((a) => !!a.repo || !!a.image),
    hasDeploy: Object.keys(deploys).length > 0,
    hasSuccess: Object.values(deploys).some((d) => d.status === "succeeded"),
  };
  const nameError = newName.trim() ? validateAppName(newName) : null;
  const nameSuggestion = nameError ? slugifyAppName(newName) : "";
  const showSuggestion = nameSuggestion !== "" && nameSuggestion !== newName.trim();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">ShipSquares</span>
        </div>
        <div className="topbar-right">
          <a className="btn btn-ghost btn-sm" href="#/studio">
            Database
          </a>
          <a className="btn btn-ghost btn-sm" href="#/backups">
            Backups
          </a>
          <a className="btn btn-ghost btn-sm" href="#/mail">
            Email
          </a>
          <a className="btn btn-ghost btn-sm" href="#/catalog">
            Catalog
          </a>
          <UserMenu />
        </div>
      </header>

      <main className="page">
        <div className="page-head">
          <h1>Dashboard</h1>
          <p className="muted">Your apps, deployments, and servers — all live.</p>
        </div>

        {apps !== null && !onboardingComplete(onboarding) && (
          <Onboarding state={onboarding} onCreateApp={() => setShowNew(true)} />
        )}

        <section className="card">
          <div className="card-head">
            <h2>Apps</h2>
            <button className="btn btn-primary btn-sm" onClick={() => setShowNew((v) => !v)}>
              {showNew ? "Cancel" : "New app"}
            </button>
          </div>

          {showNew && (
            <details className="repo-picker-details">
              <summary>Pick from a connected repo</summary>
              <RepoPicker
                onPick={(repo, connectionId) => {
                  setNewName(slugifyAppName(repo.name));
                  setNewRepo(repo.cloneUrl);
                  setNewVcsConnectionId(connectionId);
                }}
              />
            </details>
          )}
          {showNew && (
            <form className="new-app" onSubmit={onCreate}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                aria-label="App name"
                placeholder="name (e.g. api)"
                maxLength={63}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? "new-app-name-error" : undefined}
              />
              <input
                value={newRepo}
                onChange={(e) => {
                  setNewRepo(e.target.value);
                  setNewVcsConnectionId(""); // a manual repo edit unbinds the picked connection
                }}
                aria-label="Git repository URL"
                placeholder="git repo url"
              />
              <input
                value={newImage}
                onChange={(e) => setNewImage(e.target.value)}
                aria-label="Docker image"
                placeholder="or docker image (e.g. nginx:alpine)"
              />
              <input
                value={newPort}
                onChange={(e) => setNewPort(e.target.value)}
                aria-label="Container port"
                placeholder="port (default 8080)"
                inputMode="numeric"
              />
              <input
                value={newCpu}
                onChange={(e) => setNewCpu(e.target.value)}
                aria-label="CPU cores"
                placeholder="cpu cores (e.g. 0.5)"
                inputMode="decimal"
              />
              <input
                value={newMem}
                onChange={(e) => setNewMem(e.target.value)}
                aria-label="Memory limit MB"
                placeholder="memory MB (e.g. 256)"
                inputMode="numeric"
              />
              <button
                className="btn btn-primary btn-sm"
                type="submit"
                disabled={creating || !newName.trim() || !!nameError}
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </form>
          )}
          {showNew && nameError && (
            <p id="new-app-name-error" className="field-error">
              {nameError}
              {showSuggestion && (
                <>
                  {" — "}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setNewName(nameSuggestion)}
                  >
                    use “{nameSuggestion}”
                  </button>
                </>
              )}
            </p>
          )}

          {apps === null ? (
            <SkeletonRows count={3} />
          ) : apps.length > 0 ? (
            <ul className="app-list">
              {apps.map((a) => {
                const st = deploys[a.id]?.status;
                const busy = st === "queued" || st === "running";
                return (
                  <li key={a.id} className="app-row">
                    <a className="app-name app-link" href={`#/apps/${a.id}`}>
                      {a.name}
                    </a>
                    {a.branch && <span className="muted mono">{a.branch}</span>}
                    <span className="app-id muted mono">{a.id}</span>
                    {st && <StatusPill status={st} />}
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => void deploy(a.id)}
                      disabled={busy || (!a.repo && !a.image)}
                      title={a.repo ? "Deploy" : "Add a repo to deploy"}
                    >
                      {busy ? "Deploying…" : "Deploy"}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              title="No apps yet"
              description={note || "Create your first app to get started."}
              action={
                <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>
                  New app
                </button>
              }
            />
          )}
        </section>

        <NotificationsCard />
      </main>
    </div>
  );
}

interface ChannelRow {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  events: string[];
}

function NotificationsCard() {
  const [channels, setChannels] = useState<ChannelRow[] | null>(null);
  const [show, setShow] = useState(false);
  const [kind, setKind] = useState("slack");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const r = await api.get<ChannelRow[]>("/api/v1/notification-channels");
    if (r.ok) setChannels(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;
    setBusy(true);
    setMsg("");
    const r = await api.post("/api/v1/notification-channels", {
      kind,
      name: name.trim(),
      url: url.trim(),
    });
    setBusy(false);
    if (r.ok) {
      setName("");
      setUrl("");
      setShow(false);
      await load();
    } else {
      const d = r.data as { detail?: string } | null;
      setMsg(d?.detail ?? `Create failed (${r.status})`);
    }
  }

  async function test(id: string) {
    setMsg("");
    const r = await api.post<{ delivered: boolean }>(`/api/v1/notification-channels/${id}/test`);
    setMsg(r.ok && r.data.delivered ? "Test delivered ✓" : "Test failed — check the URL.");
  }

  async function remove(id: string) {
    await api.del(`/api/v1/notification-channels/${id}`);
    await load();
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Notifications</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setShow((v) => !v)}>
          {show ? "Cancel" : "New channel"}
        </button>
      </div>
      <p className="muted">Get a ping on every deploy success or failure.</p>

      {show && (
        <form className="new-app" onSubmit={create}>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="slack">Slack</option>
            <option value="discord">Discord</option>
            <option value="webhook">Webhook (JSON)</option>
          </select>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Channel name"
            placeholder="name (e.g. team-slack)"
            maxLength={80}
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Webhook URL"
            placeholder="webhook URL"
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add"}
          </button>
        </form>
      )}
      {msg && <p className="muted">{msg}</p>}

      {channels && channels.length > 0 ? (
        <ul className="app-list">
          {channels.map((c) => (
            <li key={c.id} className="app-row">
              <span className="pill pill-succeeded">{c.kind}</span>
              <span className="app-name">{c.name}</span>
              <span className="muted mono">{c.events.join(", ")}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => void test(c.id)}>
                Test
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                  if (
                    await confirm({
                      title: "Delete channel?",
                      message: `“${c.name}” will stop receiving deploy notifications.`,
                      danger: true,
                    })
                  )
                    void remove(c.id);
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No channels yet"
          description="Get a ping on every deploy success or failure."
          action={
            <button className="btn btn-primary btn-sm" onClick={() => setShow(true)}>
              New channel
            </button>
          }
        />
      )}
    </section>
  );
}
