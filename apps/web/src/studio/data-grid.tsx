import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useState } from "react";

import type { PendingEdit, QueryField, Sort } from "./types";
import { rowKeyOf } from "./types";

// Virtualized browse grid with optional inline editing (database-studio/05).
// Read path: fixed-height rows keep real <table> semantics (axe-friendly) while
// only the visible window renders. Write path (R(db).2): in edit mode a
// double-click turns a non-PK cell into an input (with a "set NULL" affordance);
// the rownum cell becomes a row-delete toggle. Changes bubble up as pending
// edits/deletes (shown dirty / struck) — nothing is sent until the commit bar.

function renderValue(value: unknown) {
  if (value === null || value === undefined) return <span className="cell-null">null</span>;
  if (typeof value === "object") return <span className="cell-json">{JSON.stringify(value)}</span>;
  return <>{String(value)}</>;
}

export function EditableCell({
  value,
  dirty,
  onCommit,
}: {
  value: unknown;
  dirty: boolean;
  onCommit: (next: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <span className="cell-edit">
        <input
          className="cell-input"
          aria-label="cell value"
          autoFocus
          defaultValue={value === null || value === undefined ? "" : String(value)}
          onBlur={(e) => {
            setEditing(false);
            onCommit(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setEditing(false);
              onCommit(e.currentTarget.value);
            } else if (e.key === "Escape") {
              setEditing(false);
            }
          }}
        />
        <button
          type="button"
          className="cell-null-btn"
          aria-label="set null"
          title="set NULL"
          onMouseDown={(e) => {
            // mousedown + preventDefault so the input doesn't blur-commit first.
            e.preventDefault();
            setEditing(false);
            onCommit(null);
          }}
        >
          ␀
        </button>
      </span>
    );
  }
  return (
    <span
      className={dirty ? "cell-dirty" : undefined}
      onDoubleClick={() => setEditing(true)}
      title="double-click to edit"
    >
      {renderValue(value)}
    </span>
  );
}

export function DataGrid({
  fields,
  rows,
  primaryKey,
  sort,
  onSort,
  loading,
  editable = false,
  pending,
  onEditCell,
  deletedKeys,
  onToggleDelete,
}: {
  fields: QueryField[];
  rows: Record<string, unknown>[];
  primaryKey: string[];
  sort: Sort | null;
  onSort: (column: string) => void;
  loading: boolean;
  editable?: boolean;
  pending?: Map<string, PendingEdit>;
  onEditCell?: (row: Record<string, unknown>, column: string, value: string | null) => void;
  deletedKeys?: Set<string>;
  onToggleDelete?: (row: Record<string, unknown>) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 32,
    overscan: 16,
  });
  const pk = new Set(primaryKey);
  const canEdit = editable && primaryKey.length > 0;
  const items = virtualizer.getVirtualItems();
  const colCount = fields.length + 1;
  const paddingTop = items.length ? items[0]!.start : 0;
  const paddingBottom = items.length
    ? virtualizer.getTotalSize() - items[items.length - 1]!.end
    : 0;

  return (
    <div className="grid-scroll" ref={scrollRef}>
      <table className="grid-table">
        <thead>
          <tr>
            <th scope="col" className="grid-rownum">
              #
            </th>
            {fields.map((f) => {
              const active = sort?.column === f.name;
              return (
                <th scope="col" key={f.name}>
                  <button
                    type="button"
                    className="grid-colbtn"
                    onClick={() => onSort(f.name)}
                    title={`${f.name} · ${f.dataType}${pk.has(f.name) ? " · primary key" : ""}`}
                  >
                    <span className={pk.has(f.name) ? "grid-pk" : undefined}>{f.name}</span>
                    <span className="grid-sort" aria-hidden>
                      {active ? (sort!.dir === "asc" ? "▲" : "▼") : ""}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr aria-hidden style={{ height: paddingTop }}>
              <td colSpan={colCount} />
            </tr>
          )}
          {items.map((vi) => {
            const row = rows[vi.index]!;
            const key = canEdit ? rowKeyOf(primaryKey, row) : "";
            const deleted = canEdit && !!deletedKeys?.has(key);
            const pend = canEdit && !deleted ? pending?.get(key) : undefined;
            return (
              <tr key={vi.key} className={deleted ? "row-deleted" : undefined}>
                <td className="grid-rownum">
                  {canEdit ? (
                    <button
                      type="button"
                      className="row-del"
                      onClick={() => onToggleDelete?.(row)}
                      title={deleted ? "undo delete" : "delete row"}
                      aria-label={deleted ? "undo delete" : "delete row"}
                    >
                      {deleted ? "↺" : "×"}
                    </button>
                  ) : (
                    vi.index + 1
                  )}
                </td>
                {fields.map((f) => {
                  const isPk = pk.has(f.name);
                  const hasPending = pend ? f.name in pend.values : false;
                  const value = hasPending ? pend!.values[f.name] : row[f.name];
                  if (canEdit && !deleted && !isPk) {
                    return (
                      <td key={f.name}>
                        <EditableCell
                          value={value}
                          dirty={hasPending}
                          onCommit={(v) => onEditCell?.(row, f.name, v)}
                        />
                      </td>
                    );
                  }
                  return (
                    <td key={f.name} className={isPk ? "grid-cell-pk" : undefined}>
                      {renderValue(value)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {paddingBottom > 0 && (
            <tr aria-hidden style={{ height: paddingBottom }}>
              <td colSpan={colCount} />
            </tr>
          )}
        </tbody>
      </table>
      {loading && <div className="grid-loading">Loading…</div>}
      {!loading && rows.length === 0 && <div className="grid-empty">No rows</div>}
    </div>
  );
}
