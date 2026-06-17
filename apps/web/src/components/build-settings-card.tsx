import { useCallback, useEffect, useState } from "react";

import { api } from "../lib/api";
import { toast } from "../lib/toast";

import { SkeletonRows } from "./skeleton";

// Build settings (R/07): pick the build strategy and its config from the UI —
// the API gained these on create/update, this makes them reachable like
// Coolify/Dokploy's build panel. Conditional fields per strategy keep it tight.

interface BuildConfig {
  rootDirectory: string | null;
  dockerfilePath: string | null;
  publishDirectory: string | null;
  builder: string | null;
}
interface AppBuild {
  buildStrategy: string;
  buildConfig: BuildConfig;
}

const STRATEGIES = ["compose", "dockerfile", "nixpacks", "buildpacks", "static"] as const;
const BLURB: Record<string, string> = {
  compose: "Run the repo's docker-compose project (falls back to Dockerfile/Nixpacks if absent).",
  dockerfile: "Build the repo's Dockerfile.",
  nixpacks: "Auto-detect the language and build with Nixpacks — no Dockerfile needed.",
  buildpacks: "Build with Cloud Native Buildpacks (pack) — no Dockerfile needed.",
  static: "Serve a directory of pre-built static files over a tiny HTTP server.",
};

export function BuildSettingsCard({ appId }: { appId: string }) {
  const [strategy, setStrategy] = useState<string | null>(null);
  const [rootDirectory, setRootDirectory] = useState("");
  const [dockerfilePath, setDockerfilePath] = useState("");
  const [publishDirectory, setPublishDirectory] = useState("");
  const [builder, setBuilder] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<AppBuild>(`/api/v1/apps/${appId}`);
    if (!r.ok) return;
    setStrategy(r.data.buildStrategy);
    setRootDirectory(r.data.buildConfig.rootDirectory ?? "");
    setDockerfilePath(r.data.buildConfig.dockerfilePath ?? "");
    setPublishDirectory(r.data.buildConfig.publishDirectory ?? "");
    setBuilder(r.data.buildConfig.builder ?? "");
  }, [appId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!strategy) return;
    setSaving(true);
    const buildConfig: Record<string, string> = {};
    if (rootDirectory.trim()) buildConfig.rootDirectory = rootDirectory.trim();
    if (strategy === "dockerfile" && dockerfilePath.trim())
      buildConfig.dockerfilePath = dockerfilePath.trim();
    if (strategy === "static" && publishDirectory.trim())
      buildConfig.publishDirectory = publishDirectory.trim();
    if (strategy === "buildpacks" && builder.trim()) buildConfig.builder = builder.trim();
    const r = await api.patch(`/api/v1/apps/${appId}`, { buildStrategy: strategy, buildConfig });
    setSaving(false);
    toast[r.ok ? "success" : "error"](
      r.ok ? "Build settings saved — applies on the next deploy" : `Save failed (${r.status})`,
    );
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Build settings</h2>
      </div>
      {strategy === null ? (
        <SkeletonRows count={2} />
      ) : (
        <>
          <div className="form-row">
            <label className="field">
              <span className="field-label">Strategy</span>
              <select
                className="role-select"
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                aria-label="Build strategy"
              >
                {STRATEGIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Root directory (optional)</span>
              <input
                className="chat-input mono"
                value={rootDirectory}
                onChange={(e) => setRootDirectory(e.target.value)}
                placeholder="."
              />
            </label>
          </div>
          <p className="muted">{BLURB[strategy]}</p>

          {strategy === "dockerfile" && (
            <label className="field">
              <span className="field-label">Dockerfile path</span>
              <input
                className="chat-input mono"
                value={dockerfilePath}
                onChange={(e) => setDockerfilePath(e.target.value)}
                placeholder="Dockerfile"
              />
            </label>
          )}
          {strategy === "static" && (
            <label className="field">
              <span className="field-label">Publish directory</span>
              <input
                className="chat-input mono"
                value={publishDirectory}
                onChange={(e) => setPublishDirectory(e.target.value)}
                placeholder="dist"
              />
            </label>
          )}
          {strategy === "buildpacks" && (
            <label className="field">
              <span className="field-label">Builder image (optional)</span>
              <input
                className="chat-input mono"
                value={builder}
                onChange={(e) => setBuilder(e.target.value)}
                placeholder="paketobuildpacks/builder-jammy-base"
              />
            </label>
          )}

          <div className="card-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save build settings"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
