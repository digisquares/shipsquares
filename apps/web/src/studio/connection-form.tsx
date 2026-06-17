import { useState, type FormEvent } from "react";

import { api } from "../lib/api";
import { toast } from "../lib/toast";

import type { ConnectionView } from "./types";

type Engine = "postgres" | "mysql" | "mariadb";

// Add an external connection profile (database-studio/05). The password is sealed
// server-side; this form never sees it again. Test connectivity from the rail
// after saving (POST /db-connections/:id/test).
export function ConnectionForm({
  onCreated,
  onCancel,
}: {
  onCreated: (c: ConnectionView) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [engine, setEngine] = useState<Engine>("postgres");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("5432");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tls, setTls] = useState(true);
  const [busy, setBusy] = useState(false);

  function changeEngine(value: string) {
    const e: Engine = value === "mysql" || value === "mariadb" ? value : "postgres";
    setEngine(e);
    setPort(e === "postgres" ? "5432" : "3306");
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    const res = await api.post<ConnectionView>("/api/v1/db-connections", {
      name,
      engine,
      host,
      port: Number(port) || (engine === "postgres" ? 5432 : 3306),
      database,
      username,
      password,
      tls,
    });
    setBusy(false);
    if (res.ok && res.data && res.data.id) {
      toast.success(`Added "${name}"`);
      onCreated(res.data);
    } else {
      const d = res.data as { detail?: string } | null;
      toast.error(d?.detail ?? `Could not add connection (${res.status}).`);
    }
  }

  return (
    <form className="conn-form" onSubmit={submit}>
      <label className="field">
        <span className="field-label">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="prod-pg"
        />
      </label>
      <label className="field">
        <span className="field-label">Engine</span>
        <select value={engine} onChange={(e) => changeEngine(e.target.value)}>
          <option value="postgres">PostgreSQL</option>
          <option value="mysql">MySQL</option>
          <option value="mariadb">MariaDB</option>
        </select>
      </label>
      <div className="conn-form-row">
        <label className="field">
          <span className="field-label">Host</span>
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            required
            placeholder="db.example.com"
          />
        </label>
        <label className="field">
          <span className="field-label">Port</span>
          <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Database</span>
        <input
          value={database}
          onChange={(e) => setDatabase(e.target.value)}
          required
          placeholder="appdb"
        />
      </label>
      <div className="conn-form-row">
        <label className="field">
          <span className="field-label">User</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      </div>
      <label className="conn-tls">
        <input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} /> Use TLS
      </label>
      <div className="card-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Adding…" : "Add connection"}
        </button>
      </div>
    </form>
  );
}
