import type { QueryField } from "./types";

// Pending new-row entry for the commit bar (database-studio/05). Rendered above
// the grid in edit mode; each row is one input per column. On commit, only the
// columns the user filled are sent — blanks are omitted so DB defaults / NULL
// apply. Kept out of the virtualized grid body (inserts are few).
export interface InsertRow {
  id: string;
  values: Record<string, string>;
}

export function InsertRows({
  fields,
  rows,
  onAdd,
  onChange,
  onRemove,
}: {
  fields: QueryField[];
  rows: InsertRow[];
  onAdd: () => void;
  onChange: (id: string, column: string, value: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="insert-panel">
      <div className="insert-head">
        <span className="insert-title">New rows</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onAdd}>
          + Add row
        </button>
      </div>
      {rows.map((r) => (
        <div className="insert-row" key={r.id}>
          {fields.map((f) => (
            <label className="insert-cell" key={f.name}>
              <span className="insert-label">{f.name}</span>
              <input
                value={r.values[f.name] ?? ""}
                onChange={(e) => onChange(r.id, f.name, e.target.value)}
                placeholder={f.dataType}
                aria-label={`new ${f.name}`}
              />
            </label>
          ))}
          <button
            type="button"
            className="btn btn-ghost btn-sm insert-remove"
            onClick={() => onRemove(r.id)}
            aria-label="discard new row"
            title="discard"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
