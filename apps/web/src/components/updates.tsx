import { useCallback, useEffect, useState } from "react";

import { api } from "../lib/api";
import { confirm } from "../lib/confirm";
import { toast } from "../lib/toast";

import { SkeletonRows } from "./skeleton";

// Update notification UI (auto-update.md · Phases 1–2). Reads the singleton
// update_state the server's update-check cron maintains; the badge is a small
// topbar indicator and the card adds a manual re-check + (owner/admin) one-click
// apply with progress that survives the control-plane restart.

export interface UpdateState {
  currentVersion: string;
  latestVersion: string | null;
  channel: string;
  updateAvailable: boolean;
  notesUrl: string | null;
  releasedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export interface UpdateProgress {
  state: "idle" | "running" | "done" | "failed";
  step: string | null;
  fromVersion: string | null;
  toVersion: string | null;
  message: string | null;
  ts: string | null;
}

export interface UpdateSettings {
  channel: string;
  autoUpdate: boolean;
}

const INSTALL_CMD = "curl -fsSL https://get.shipsquares.com | bash";

/** Topbar pill shown only when an update is available; links to Settings. */
export function UpdateBadge() {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    let alive = true;
    void api.get<UpdateState>("/api/v1/system/updates").then((r) => {
      if (alive && r.ok) setState(r.data);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!state?.updateAvailable) return null;
  return (
    <a
      className="pill pill-info"
      href="#/settings"
      title={`Version ${state.latestVersion ?? ""} is available`}
    >
      Update available
    </a>
  );
}

/** Settings → Updates: current vs latest, release notes, a manual re-check, and a
 *  one-click apply that polls progress across the control-plane restart. */
export function UpdatesCard() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [settings, setSettings] = useState<UpdateSettings | null>(null);

  const load = useCallback(async () => {
    const r = await api.get<UpdateState>("/api/v1/system/updates");
    if (r.ok) {
      setState(r.data);
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
    const s = await api.get<UpdateSettings>("/api/v1/system/updates/settings");
    if (s.ok) setSettings(s.data);
  }, []);

  const saveSettings = useCallback(async (patch: Partial<UpdateSettings>) => {
    const r = await api.put<UpdateSettings>("/api/v1/system/updates/settings", patch);
    if (r.ok) {
      setSettings(r.data);
      toast.success("Update settings saved");
    } else {
      toast.error(
        r.status === 403 ? "Your role can't change update settings" : `Save failed (${r.status})`,
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const check = useCallback(async () => {
    setChecking(true);
    const r = await api.post<UpdateState>("/api/v1/system/updates/check");
    setChecking(false);
    if (r.ok) {
      setState(r.data);
      if (r.data.updateAvailable) toast.success(`Update available: ${r.data.latestVersion}`);
      else toast.info("You're up to date");
    } else {
      toast.error(
        r.status === 403 ? "Your role can't check for updates" : `Check failed (${r.status})`,
      );
    }
  }, []);

  // Poll the updater's status across the restart. fetch failures (API down mid-
  // restart) are expected — keep polling until the state turns terminal.
  useEffect(() => {
    if (!applying) return;
    let stop = false;
    const id = setInterval(() => {
      void api.get<UpdateProgress>("/api/v1/system/updates/progress").then((r) => {
        if (stop || !r.ok) return;
        setProgress(r.data);
        if (r.data.state === "done") {
          stop = true;
          clearInterval(id);
          toast.success("Updated — reloading…");
          setTimeout(() => window.location.reload(), 1500);
        } else if (r.data.state === "failed") {
          stop = true;
          clearInterval(id);
          setApplying(false);
          toast.error(r.data.message ?? "Update failed");
        }
      });
    }, 2000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [applying]);

  const apply = useCallback(async () => {
    const ok = await confirm({
      title: "Update ShipSquares?",
      message: `Update to ${state?.latestVersion} now? The control plane will briefly restart.`,
      confirmLabel: "Update now",
    });
    if (!ok) return;
    const r = await api.post<{ accepted: boolean; toVersion: string }>(
      "/api/v1/system/updates/apply",
    );
    if (r.ok) {
      setApplying(true);
      setProgress({
        state: "running",
        step: "starting",
        message: "starting update…",
        fromVersion: state?.currentVersion ?? null,
        toVersion: state?.latestVersion ?? null,
        ts: null,
      });
    } else {
      toast.error(
        r.status === 403
          ? "Your role can't apply updates"
          : r.status === 409
            ? "Already up to date"
            : `Update failed to start (${r.status})`,
      );
    }
  }, [state]);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Updates</h2>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => void check()}
          disabled={checking || applying}
        >
          {checking ? "Checking…" : "Check for updates"}
        </button>
      </div>

      {loadFailed ? (
        <p className="muted">Couldn't load update status.</p>
      ) : !state ? (
        <SkeletonRows count={2} />
      ) : (
        <>
          <p className="muted">
            Running <code>{state.currentVersion}</code> on the <code>{state.channel}</code> channel.
          </p>

          {applying && progress ? (
            <p>
              <span className="pill pill-live">{progress.step ?? progress.state}</span>{" "}
              {progress.message ?? "updating…"}
            </p>
          ) : state.updateAvailable ? (
            <p>
              <span className="pill pill-info">Update available</span>{" "}
              <strong>{state.latestVersion}</strong>
              {state.notesUrl ? (
                <>
                  {" — "}
                  <a href={state.notesUrl} target="_blank" rel="noreferrer">
                    Release notes ↗
                  </a>
                </>
              ) : null}{" "}
              <button className="btn btn-primary btn-sm" onClick={() => void apply()}>
                Update now
              </button>
            </p>
          ) : (
            <p>
              <span className="pill pill-ok">Up to date</span>
            </p>
          )}

          {settings ? (
            <p>
              <label>
                Channel{" "}
                <select
                  value={settings.channel}
                  disabled={applying}
                  onChange={(e) => void saveSettings({ channel: e.target.value })}
                >
                  <option value="stable">stable</option>
                  <option value="beta">beta</option>
                </select>
              </label>{" "}
              <label>
                <input
                  type="checkbox"
                  checked={settings.autoUpdate}
                  disabled={applying}
                  onChange={(e) => void saveSettings({ autoUpdate: e.target.checked })}
                />{" "}
                Auto-update — apply new {settings.channel} releases automatically
              </label>
            </p>
          ) : null}

          <p className="muted">
            Or re-run the installer: <code>{INSTALL_CMD}</code>
            {state.lastCheckedAt ? (
              <> · last checked {new Date(state.lastCheckedAt).toLocaleString()}</>
            ) : null}
          </p>
          {state.lastError ? <p className="muted">Last check error: {state.lastError}</p> : null}
        </>
      )}
    </section>
  );
}
