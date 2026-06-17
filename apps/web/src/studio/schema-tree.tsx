import { useState } from "react";

import type { SchemaNode, TableNode } from "./types";

// Schema browser: schemas → tables/views (database-studio/05). Plain focusable
// buttons (not ARIA tree roles) keep it accessible without partial-tree axe
// violations; aria-expanded marks open schemas and aria-current the open table.

const fmtCount = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);

export function SchemaTree({
  schemas,
  selected,
  onSelect,
}: {
  schemas: SchemaNode[];
  selected: { schema: string; name: string } | null;
  onSelect: (table: TableNode) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(schemas.map((s, i) => [s.name, i === 0])),
  );
  const toggle = (name: string) => setOpen((o) => ({ ...o, [name]: !o[name] }));

  return (
    <div className="tree">
      {schemas.map((s) => (
        <div key={s.name} className="tree-schema">
          <button
            type="button"
            className="tree-row tree-schema-row"
            aria-expanded={!!open[s.name]}
            onClick={() => toggle(s.name)}
          >
            <span className="tree-caret" aria-hidden>
              {open[s.name] ? "▾" : "▸"}
            </span>
            <span className="tree-label">{s.name}</span>
            <span className="tree-count">{s.tables.length}</span>
          </button>
          {open[s.name] && (
            <div className="tree-tables">
              {s.tables.map((t) => {
                const active = selected?.schema === s.name && selected?.name === t.name;
                return (
                  <button
                    key={t.name}
                    type="button"
                    className="tree-row tree-table-row"
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelect(t)}
                    title={`${t.kind} ${t.schema}.${t.name}`}
                  >
                    <span className="tree-glyph" aria-hidden>
                      {t.kind === "view" ? "◫" : "▦"}
                    </span>
                    <span className="tree-label">{t.name}</span>
                    {t.estimatedRows != null && (
                      <span className="tree-count" title="estimated rows">
                        ≈{fmtCount(t.estimatedRows)}
                      </span>
                    )}
                  </button>
                );
              })}
              {s.tables.length === 0 && <p className="tree-row muted">no tables</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
