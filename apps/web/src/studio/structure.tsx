import { buildCreateTable } from "./ddl";
import type { ConnectionView, TableDetail } from "./types";

// Per-table structure view (database-studio/05, R(db).3): columns (type / null /
// default / PK), foreign keys, and a reconstructed CREATE statement. Read-only —
// structured DDL editing is a later R(db).3 slice; raw DDL already runs via the
// write-mode SQL tab.
export function Structure({
  detail,
  engine,
}: {
  detail: TableDetail;
  engine: ConnectionView["engine"];
}) {
  return (
    <div className="structure">
      <section>
        <h3 className="structure-h">Columns</h3>
        <table className="structure-table">
          <thead>
            <tr>
              <th scope="col">Column</th>
              <th scope="col">Type</th>
              <th scope="col">Null</th>
              <th scope="col">Default</th>
              <th scope="col">Key</th>
            </tr>
          </thead>
          <tbody>
            {detail.columns.map((c) => (
              <tr key={c.name}>
                <td className="mono">{c.name}</td>
                <td className="mono muted">{c.dataType}</td>
                <td>{c.nullable ? "✓" : ""}</td>
                <td className="mono muted">{c.default ?? ""}</td>
                <td>{c.isPrimaryKey ? <span className="grid-pk">PK</span> : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {detail.foreignKeys.length > 0 && (
        <section>
          <h3 className="structure-h">Foreign keys</h3>
          <ul className="structure-list">
            {detail.foreignKeys.map((fk) => (
              <li key={fk.name} className="mono">
                {fk.columns.join(", ")} → {fk.refSchema}.{fk.refTable}({fk.refColumns.join(", ")})
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail.indexes.length > 0 && (
        <section>
          <h3 className="structure-h">Indexes</h3>
          <ul className="structure-list">
            {detail.indexes.map((ix) => (
              <li key={ix.name} className="mono">
                {ix.name} ({ix.columns.join(", ")})
                {ix.primary ? " · primary" : ix.unique ? " · unique" : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="structure-h">CREATE (reconstructed)</h3>
        <pre className="structure-pre">{buildCreateTable(engine, detail)}</pre>
      </section>
    </div>
  );
}
