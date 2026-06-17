import { useState } from "react";

import { api } from "../lib/api";

import { DataGrid } from "./data-grid";
import { pushQuery, recentQueries } from "./history";
import { SqlEditor } from "./sql-editor";
import type { QueryField } from "./types";

// SQL runner (database-studio/03/05): CodeMirror editor → POST
// /db-connections/:id/query → results in the shared grid. Reads always work;
// writes need a writable connection + dbstudio:write (server-enforced), and a
// destructive statement comes back 409 confirm_required → "Run anyway" re-sends
// with confirm. Recent queries persist (history); the `schema` feeds table-name
// autocomplete. Loading a history item remounts the editor (key={seed}).

interface RunResult {
  fields: QueryField[];
  rows: Record<string, unknown>[];
  rowCount: number;
  command: string;
  elapsedMs: number;
  truncated: boolean;
}

export function SqlRunner({
  connId,
  readOnly,
  schema,
}: {
  connId: string;
  readOnly: boolean;
  schema?: Record<string, string[]>;
}) {
  const [sqlText, setSqlText] = useState("select 1;");
  const [seed, setSeed] = useState(0);
  const [history, setHistory] = useState<string[]>(() => recentQueries());
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  function loadFromHistory(sql: string) {
    setSqlText(sql);
    setSeed((s) => s + 1);
  }

  async function run(confirm = false) {
    const sql = sqlText.trim();
    if (!sql || busy) return;
    setBusy(true);
    setError(null);
    setHistory(pushQuery(sql));
    const r = await api.post<RunResult | { code?: string; detail?: string }>(
      `/api/v1/db-connections/${encodeURIComponent(connId)}/query`,
      { sql, ...(confirm ? { confirm: true } : {}) },
    );
    setBusy(false);
    if (r.ok && r.data && "rows" in r.data) {
      setResult(r.data);
      setNeedsConfirm(false);
    } else {
      const d = r.data as { code?: string; detail?: string } | null;
      setResult(null);
      if (d?.code === "dbstudio.confirm_required") {
        setNeedsConfirm(true);
        setError(d.detail ?? "This statement is destructive.");
      } else {
        setNeedsConfirm(false);
        setError(d?.detail ?? `Query failed (${r.status}).`);
      }
    }
  }

  return (
    <div className="sql-runner">
      <div className="sql-pane">
        <SqlEditor
          key={seed}
          value={sqlText}
          schema={schema}
          onChange={setSqlText}
          onRun={() => void run()}
        />
        <div className="sql-actions">
          {readOnly && (
            <span className="ro-badge" title="read-only connection">
              read-only
            </span>
          )}
          {history.length > 0 && (
            <select
              className="sql-history"
              aria-label="Query history"
              value=""
              onChange={(e) => {
                const q = history[Number(e.target.value)];
                if (q !== undefined) loadFromHistory(q);
              }}
            >
              <option value="">History…</option>
              {history.map((q, i) => (
                <option key={i} value={i}>
                  {q.length > 60 ? `${q.slice(0, 60)}…` : q}
                </option>
              ))}
            </select>
          )}
          <span className="studio-meta">⌘↵ to run</span>
          <span className="studio-spacer" />
          {needsConfirm && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => void run(true)}
              disabled={busy}
            >
              Run anyway (destructive)
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void run()}
            disabled={busy}
          >
            {busy ? "Running…" : "Run"}
          </button>
        </div>
      </div>
      <div className="sql-results">
        {error ? (
          <div className={needsConfirm ? "sql-error sql-warn" : "sql-error"} role="alert">
            {error}
          </div>
        ) : result ? (
          result.fields.length > 0 ? (
            <>
              <div className="sql-resultbar">
                <span className="studio-meta">
                  {result.rowCount} row{result.rowCount === 1 ? "" : "s"} · {result.elapsedMs} ms
                  {result.truncated ? ` · capped at ${result.rows.length}` : ""}
                </span>
              </div>
              <DataGrid
                fields={result.fields}
                rows={result.rows}
                primaryKey={[]}
                sort={null}
                onSort={() => undefined}
                loading={false}
              />
            </>
          ) : (
            <div className="grid-empty">
              {result.command || "OK"} · {result.rowCount} row(s) · {result.elapsedMs} ms
            </div>
          )
        ) : (
          <div className="grid-empty">Run a query to see results.</div>
        )}
      </div>
    </div>
  );
}
