import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { connectionLabel, filterRepos, type RepoRef, type VcsConnection } from "../lib/connections";

// Pick a repo from a connected VCS provider (26 / doc 25 flow 2). Lists the
// org's connections, fetches the selected one's repos, search-filters, and calls
// onPick. Empty state points to Settings to connect first.
export function RepoPicker({ onPick }: { onPick: (repo: RepoRef, connectionId: string) => void }) {
  const [conns, setConns] = useState<VcsConnection[] | null>(null);
  const [connId, setConnId] = useState("");
  const [repos, setRepos] = useState<RepoRef[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void api.get<VcsConnection[]>("/api/v1/vcs-connections").then((r) => {
      const list = r.ok ? r.data : [];
      setConns(list);
      if (list[0]) setConnId(list[0].id);
    });
  }, []);

  // Epoch guard: switching connections mid-fetch must not render the previous
  // connection's repos when its slower response lands.
  const epochRef = useRef(0);
  const loadRepos = useCallback(async (id: string) => {
    const epoch = ++epochRef.current;
    setRepos(null);
    setError("");
    const r = await api.get<RepoRef[]>(`/api/v1/vcs-connections/${id}/repos`);
    if (epochRef.current !== epoch) return; // a newer load superseded this one
    if (r.ok) setRepos(r.data);
    else {
      setRepos([]);
      setError(`Couldn't list repos (${r.status}).`);
    }
  }, []);

  useEffect(() => {
    if (connId) void loadRepos(connId);
  }, [connId, loadRepos]);

  if (conns === null) return <p className="muted">Loading connections…</p>;
  if (conns.length === 0) {
    return (
      <p className="muted repo-picker-empty">
        No git connections yet. <a href="#/admin/connections">Connect a provider</a> to pick a repo.
      </p>
    );
  }

  const shown = repos ? filterRepos(repos, query) : [];
  return (
    <div className="repo-picker">
      <div className="repo-picker-bar">
        <select value={connId} onChange={(e) => setConnId(e.target.value)} aria-label="Connection">
          {conns.map((c) => (
            <option key={c.id} value={c.id}>
              {connectionLabel(c)}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Search repos…"
          aria-label="Search repositories"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error ? <p className="field-error">{error}</p> : null}
      {repos === null ? (
        <p className="muted">Loading repos…</p>
      ) : shown.length === 0 ? (
        <p className="muted">{repos.length === 0 ? "No repositories." : "No matches."}</p>
      ) : (
        <ul className="repo-list">
          {shown.slice(0, 50).map((r) => (
            <li key={r.fullName}>
              <button type="button" className="repo-item" onClick={() => onPick(r, connId)}>
                <span className="repo-name mono">{r.fullName}</span>
                <span className="muted mono">{r.defaultBranch}</span>
                {r.private ? <span className="pill pill-neutral">private</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown.length > 50 ? (
        <p className="muted">Showing 50 of {shown.length} — refine the search to see the rest.</p>
      ) : null}
    </div>
  );
}
