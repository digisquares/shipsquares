import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { api } from "../lib/api";
import { toast } from "../lib/toast";
import { CommitBar } from "../studio/commit-bar";
import { ConnectionForm } from "../studio/connection-form";
import { DataGrid } from "../studio/data-grid";
import { download, toCsv, toJson } from "../studio/export";
import { InsertRows, type InsertRow } from "../studio/insert-rows";
import { SchemaTree } from "../studio/schema-tree";
import { SqlRunner } from "../studio/sql-runner";
import { Structure } from "../studio/structure";
import {
  rowKeyOf,
  type ConnectionView,
  type PendingEdit,
  type RowsPage,
  type SchemaNode,
  type Sort,
  type TableDetail,
  type TableNode,
} from "../studio/types";
import "../studio/studio.css";

// Database Studio workspace (database-studio/05). Full-bleed: connection rail →
// schema tree → virtualized browse grid + SQL tab. Server-side proxy — the
// browser only ever speaks REST; credentials never leave the control plane.
// Read path + write path (inline cell edit → commit-bar atomic apply).

const PAGE = 100;
const enc = encodeURIComponent;

function ConnButton({
  c,
  active,
  onSelect,
}: {
  c: ConnectionView;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const badge =
    c.engine === "postgres"
      ? { cls: "pg", label: "PG" }
      : { cls: "my", label: c.engine === "mariadb" ? "MARIA" : "MYSQL" };
  return (
    <button
      type="button"
      className={`conn${active ? " is-active" : ""}`}
      aria-current={active ? "true" : undefined}
      onClick={() => onSelect(c.id)}
    >
      <span className="conn-top">
        <span className={`engine-badge ${badge.cls}`}>{badge.label}</span>
        <span className="conn-name">{c.name}</span>
        {c.readOnly && (
          <span className="tree-count" title="read-only">
            RO
          </span>
        )}
      </span>
      <span className="conn-sub">
        {c.host} / {c.database}
      </span>
    </button>
  );
}

export function Studio() {
  const [connections, setConnections] = useState<ConnectionView[] | null>(null);
  const [connId, setConnId] = useState<string | null>(null);
  const [schema, setSchema] = useState<SchemaNode[] | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [table, setTable] = useState<{ schema: string; name: string } | null>(null);
  const [rows, setRows] = useState<RowsPage | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [sort, setSort] = useState<Sort | null>(null);
  const [offset, setOffset] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [mainTab, setMainTab] = useState<"data" | "structure" | "sql">("data");
  const [filterCol, setFilterCol] = useState("");
  const [filterVal, setFilterVal] = useState("");
  const [appliedFilter, setAppliedFilter] = useState<{ column: string; value: string } | null>(
    null,
  );
  const [writeMode, setWriteMode] = useState(false);
  const [pending, setPending] = useState<Map<string, PendingEdit>>(new Map());
  const [deletes, setDeletes] = useState<Map<string, { pk: Record<string, unknown> }>>(new Map());
  const [inserts, setInserts] = useState<InsertRow[]>([]);
  const insertSeq = useRef(0);
  const [committing, setCommitting] = useState(false);
  const [detail, setDetail] = useState<TableDetail | null>(null);

  const conn = connections?.find((c) => c.id === connId) ?? null;

  // table -> [] map (schema-qualified + bare names) for SQL-editor autocomplete.
  const sqlTables: Record<string, string[]> = {};
  for (const s of schema ?? []) {
    for (const t of s.tables) {
      sqlTables[t.name] = [];
      sqlTables[`${s.name}.${t.name}`] = [];
    }
  }

  const loadConnections = useCallback(async () => {
    const r = await api.get<ConnectionView[]>("/api/v1/db-connections");
    if (r.ok && Array.isArray(r.data)) setConnections(r.data);
    else {
      setConnections([]);
      if (r.status) toast.error(`Connections API responded ${r.status}.`);
    }
  }, []);
  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  const selectConnection = useCallback(async (id: string) => {
    setConnId(id);
    setSchema(null);
    setTable(null);
    setRows(null);
    setSort(null);
    setOffset(0);
    setAppliedFilter(null);
    setWriteMode(false);
    setPending(new Map());
    setDeletes(new Map());
    setInserts([]);
    setSchemaLoading(true);
    const r = await api.get<SchemaNode[]>(`/api/v1/db-connections/${enc(id)}/schema`);
    setSchemaLoading(false);
    if (r.ok && Array.isArray(r.data)) setSchema(r.data);
    else {
      setSchema([]);
      toast.error(`Could not read schema (${r.status}).`);
    }
  }, []);

  const loadRows = useCallback(async () => {
    if (!connId || !table) return;
    setRowsLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (sort) params.set("sort", `${sort.column}:${sort.dir}`);
    if (appliedFilter) {
      params.set(
        "filters",
        JSON.stringify([{ column: appliedFilter.column, op: "like", value: appliedFilter.value }]),
      );
    }
    const url = `/api/v1/db-connections/${enc(connId)}/tables/${enc(table.schema)}/${enc(table.name)}/rows?${params.toString()}`;
    const r = await api.get<RowsPage>(url);
    setRowsLoading(false);
    if (r.ok && r.data) setRows(r.data);
    else {
      setRows(null);
      toast.error(`Could not read rows (${r.status}).`);
    }
  }, [connId, table, offset, sort, appliedFilter]);
  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  // Load table structure lazily when the Structure tab is opened.
  useEffect(() => {
    if (mainTab !== "structure" || !connId || !table) return undefined;
    let cancelled = false;
    setDetail(null);
    void (async () => {
      const r = await api.get<TableDetail>(
        `/api/v1/db-connections/${enc(connId)}/tables/${enc(table.schema)}/${enc(table.name)}`,
      );
      if (cancelled) return;
      if (r.ok && r.data) setDetail(r.data);
      else toast.error(`Could not read structure (${r.status}).`);
    })();
    return () => {
      cancelled = true;
    };
  }, [mainTab, connId, table]);

  function selectTable(t: TableNode) {
    setTable({ schema: t.schema, name: t.name });
    setSort(null);
    setOffset(0);
    setAppliedFilter(null);
    setFilterCol("");
    setFilterVal("");
    setMainTab("data");
    setWriteMode(false);
    setPending(new Map());
    setDeletes(new Map());
    setInserts([]);
  }
  function onSort(column: string) {
    setOffset(0);
    setSort((s) =>
      s?.column === column
        ? { column, dir: s.dir === "asc" ? "desc" : "asc" }
        : { column, dir: "asc" },
    );
  }
  function applyFilter(e: FormEvent) {
    e.preventDefault();
    setOffset(0);
    setAppliedFilter(filterCol && filterVal ? { column: filterCol, value: filterVal } : null);
  }

  function toggleWrite() {
    setWriteMode((v) => {
      if (v) {
        setPending(new Map());
        setDeletes(new Map());
        setInserts([]);
      }
      return !v;
    });
  }

  function onEditCell(row: Record<string, unknown>, column: string, value: string | null) {
    if (!rows || rows.primaryKey.length === 0) return;
    const key = rowKeyOf(rows.primaryKey, row);
    const orig = row[column];
    const unchanged =
      value === null
        ? orig === null || orig === undefined
        : value === (orig == null ? "" : String(orig));
    setPending((prev) => {
      const next = new Map(prev);
      const entry = next.get(key) ?? {
        pk: Object.fromEntries(rows.primaryKey.map((c) => [c, row[c]])),
        values: {},
      };
      const values = { ...entry.values };
      if (unchanged) delete values[column];
      else values[column] = value;
      if (Object.keys(values).length === 0) next.delete(key);
      else next.set(key, { pk: entry.pk, values });
      return next;
    });
  }

  function onToggleDelete(row: Record<string, unknown>) {
    if (!rows || rows.primaryKey.length === 0) return;
    const key = rowKeyOf(rows.primaryKey, row);
    setDeletes((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, { pk: Object.fromEntries(rows.primaryKey.map((c) => [c, row[c]])) });
      return next;
    });
    // Editing a row you're deleting is pointless — drop any pending cell edits.
    setPending((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }

  function addInsert() {
    setInserts((p) => [...p, { id: `new${insertSeq.current++}`, values: {} }]);
  }
  function changeInsert(id: string, column: string, value: string) {
    setInserts((p) =>
      p.map((r) => (r.id === id ? { ...r, values: { ...r.values, [column]: value } } : r)),
    );
  }
  function removeInsert(id: string) {
    setInserts((p) => p.filter((r) => r.id !== id));
  }

  async function commitEdits() {
    if (!connId || !table) return;
    const insertEdits = inserts
      .map((ins) => Object.fromEntries(Object.entries(ins.values).filter(([, v]) => v !== "")))
      .filter((values) => Object.keys(values).length > 0)
      .map((values) => ({
        op: "insert" as const,
        schema: table.schema,
        table: table.name,
        values,
      }));
    const edits = [
      ...insertEdits,
      ...[...pending.values()].map((p) => ({
        op: "update" as const,
        schema: table.schema,
        table: table.name,
        pk: p.pk,
        values: p.values,
      })),
      ...[...deletes.values()].map((d) => ({
        op: "delete" as const,
        schema: table.schema,
        table: table.name,
        pk: d.pk,
      })),
    ];
    if (edits.length === 0) return;
    setCommitting(true);
    const r = await api.post(`/api/v1/db-connections/${enc(connId)}/edits`, { edits });
    setCommitting(false);
    if (r.ok) {
      toast.success(`Applied ${edits.length} change${edits.length === 1 ? "" : "s"}`);
      setPending(new Map());
      setDeletes(new Map());
      setInserts([]);
      void loadRows();
    } else {
      const d = r.data as { detail?: string } | null;
      toast.error(d?.detail ?? `Commit failed (${r.status}).`);
    }
  }

  const testConn = useCallback(async (id: string) => {
    const r = await api.post<{ ok: boolean; serverVersion?: string; error?: string }>(
      `/api/v1/db-connections/${enc(id)}/test`,
    );
    if (r.ok && r.data?.ok) toast.success(`Connected · ${r.data.serverVersion ?? "ok"}`);
    else toast.error(r.data?.error ?? `Test failed (${r.status}).`);
  }, []);
  const removeConn = useCallback(
    async (id: string) => {
      const r = await api.del(`/api/v1/db-connections/${enc(id)}`);
      if (r.ok) {
        toast.success("Removed");
        if (connId === id) {
          setConnId(null);
          setSchema(null);
          setTable(null);
          setRows(null);
        }
        void loadConnections();
      } else toast.error(`Remove failed (${r.status}).`);
    },
    [connId, loadConnections],
  );

  const managed = connections?.filter((c) => c.source === "managed") ?? [];
  const external = connections?.filter((c) => c.source === "external") ?? [];

  return (
    <div className="studio">
      <div className="studio-header">
        <span className="studio-title">Database Studio</span>
      </div>

      <div className="studio-body">
        <aside className="studio-rail" aria-label="Connections">
          <div className="studio-pane-head">
            <span>Connections</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-expanded={showAdd}
              onClick={() => setShowAdd((v) => !v)}
            >
              {showAdd ? "Close" : "+ Add"}
            </button>
          </div>
          {showAdd && (
            <ConnectionForm
              onCreated={(c) => {
                setShowAdd(false);
                void loadConnections();
                void selectConnection(c.id);
              }}
              onCancel={() => setShowAdd(false)}
            />
          )}
          {connections === null ? (
            <div className="conn-group">Loading…</div>
          ) : (
            <>
              {managed.length > 0 && <div className="conn-group">Managed (built-in)</div>}
              {managed.map((c) => (
                <ConnButton
                  key={c.id}
                  c={c}
                  active={c.id === connId}
                  onSelect={(id) => void selectConnection(id)}
                />
              ))}
              {external.length > 0 && <div className="conn-group">External</div>}
              {external.map((c) => (
                <ConnButton
                  key={c.id}
                  c={c}
                  active={c.id === connId}
                  onSelect={(id) => void selectConnection(id)}
                />
              ))}
              {connections.length === 0 && !showAdd && (
                <div className="conn-group">No connections yet — add one above.</div>
              )}
            </>
          )}
        </aside>

        <nav className="studio-tree" aria-label="Schema">
          <div className="studio-pane-head">
            <span>{conn ? conn.name : "Schema"}</span>
            {conn && (
              <span className="pane-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void testConn(conn.id)}
                >
                  Test
                </button>
                {conn.source === "external" && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void removeConn(conn.id)}
                  >
                    Remove
                  </button>
                )}
              </span>
            )}
          </div>
          {!conn ? (
            <div className="conn-group">Select a connection</div>
          ) : schemaLoading ? (
            <div className="conn-group">Loading…</div>
          ) : schema ? (
            <SchemaTree schemas={schema} selected={table} onSelect={selectTable} />
          ) : null}
        </nav>

        <section className="studio-main" aria-label="Data">
          {conn && (
            <div className="studio-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mainTab === "data"}
                className={`studio-tab${mainTab === "data" ? " is-active" : ""}`}
                onClick={() => setMainTab("data")}
              >
                {table ? `${table.schema}.${table.name}` : "Data"}
              </button>
              {table && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={mainTab === "structure"}
                  className={`studio-tab${mainTab === "structure" ? " is-active" : ""}`}
                  onClick={() => setMainTab("structure")}
                >
                  Structure
                </button>
              )}
              <button
                type="button"
                role="tab"
                aria-selected={mainTab === "sql"}
                className={`studio-tab${mainTab === "sql" ? " is-active" : ""}`}
                onClick={() => setMainTab("sql")}
              >
                SQL
              </button>
            </div>
          )}
          {conn && mainTab === "sql" ? (
            <SqlRunner key={conn.id} connId={conn.id} readOnly={conn.readOnly} schema={sqlTables} />
          ) : conn && mainTab === "structure" ? (
            detail ? (
              <Structure detail={detail} engine={conn.engine} />
            ) : (
              <div className="grid-empty">{table ? "Loading structure…" : "Pick a table"}</div>
            )
          ) : table ? (
            <>
              <div className="studio-toolbar">
                <span className="studio-title">
                  {table.schema}.{table.name}
                </span>
                {conn?.readOnly ? (
                  <span className="ro-badge" title="read-only connection">
                    read-only
                  </span>
                ) : (
                  <button
                    type="button"
                    className={`btn btn-sm ${writeMode ? "btn-primary" : "btn-ghost"}`}
                    onClick={toggleWrite}
                    aria-pressed={writeMode}
                    title={writeMode ? "exit edit mode" : "double-click cells to edit, then commit"}
                  >
                    {writeMode ? "Editing" : "Edit data"}
                  </button>
                )}
                <form className="filter-bar" onSubmit={applyFilter}>
                  <select
                    value={filterCol}
                    onChange={(e) => setFilterCol(e.target.value)}
                    aria-label="Filter column"
                  >
                    <option value="">Filter column…</option>
                    {(rows?.fields ?? []).map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <input
                    value={filterVal}
                    onChange={(e) => setFilterVal(e.target.value)}
                    placeholder="contains…"
                    aria-label="Filter value"
                  />
                  <button type="submit" className="btn btn-ghost btn-sm" disabled={!filterCol}>
                    Filter
                  </button>
                  {appliedFilter && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setAppliedFilter(null);
                        setFilterCol("");
                        setFilterVal("");
                      }}
                    >
                      Clear
                    </button>
                  )}
                </form>
                <span className="studio-spacer" />
                <span className="studio-meta">
                  {rows
                    ? `rows ${rows.rows.length ? offset + 1 : 0}–${offset + rows.rows.length}${rows.page.hasMore ? "+" : ""}`
                    : ""}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}
                  disabled={offset === 0 || rowsLoading}
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setOffset(offset + PAGE)}
                  disabled={!rows?.page.hasMore || rowsLoading}
                >
                  Next
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void loadRows()}
                  disabled={rowsLoading}
                  title="Refresh"
                >
                  ↻
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (rows)
                      download(`${table.name}.csv`, toCsv(rows.fields, rows.rows), "text/csv");
                  }}
                  disabled={!rows?.rows.length}
                  title="Export this page as CSV"
                >
                  CSV
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (rows) download(`${table.name}.json`, toJson(rows.rows), "application/json");
                  }}
                  disabled={!rows?.rows.length}
                  title="Export this page as JSON"
                >
                  JSON
                </button>
              </div>
              {writeMode && (
                <InsertRows
                  fields={rows?.fields ?? []}
                  rows={inserts}
                  onAdd={addInsert}
                  onChange={changeInsert}
                  onRemove={removeInsert}
                />
              )}
              <DataGrid
                fields={rows?.fields ?? []}
                rows={rows?.rows ?? []}
                primaryKey={rows?.primaryKey ?? []}
                sort={sort}
                onSort={onSort}
                loading={rowsLoading}
                editable={writeMode}
                pending={pending}
                onEditCell={onEditCell}
                deletedKeys={new Set(deletes.keys())}
                onToggleDelete={onToggleDelete}
              />
              <CommitBar
                count={pending.size + deletes.size + inserts.length}
                busy={committing}
                onDiscard={() => {
                  setPending(new Map());
                  setDeletes(new Map());
                  setInserts([]);
                }}
                onCommit={() => void commitEdits()}
              />
            </>
          ) : (
            <div className="grid-empty">
              {conn ? "Pick a table to browse" : "Pick a connection, then a table"}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
