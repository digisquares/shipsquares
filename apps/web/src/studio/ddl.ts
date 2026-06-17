import type { TableDetail } from "./types";

// Reconstruct a readable CREATE TABLE from the introspected detail
// (database-studio/05, R(db).3 structure view). Approximate by design — it's a
// structural overview built from columns/PK/FK, not the engine's exact DDL.
// Pure + unit-tested.

type Engine = "postgres" | "mysql" | "mariadb";

function quoter(engine: Engine): (s: string) => string {
  return engine === "postgres"
    ? (s) => `"${s.replaceAll('"', '""')}"`
    : (s) => `\`${s.replaceAll("`", "``")}\``;
}

export function buildCreateTable(engine: Engine, detail: TableDetail): string {
  const q = quoter(engine);
  const lines = detail.columns.map((c) => {
    let l = `  ${q(c.name)} ${c.dataType}`;
    if (!c.nullable) l += " NOT NULL";
    if (c.default != null && c.default !== "") l += ` DEFAULT ${c.default}`;
    return l;
  });
  if (detail.primaryKey.length > 0) {
    lines.push(`  PRIMARY KEY (${detail.primaryKey.map(q).join(", ")})`);
  }
  for (const fk of detail.foreignKeys) {
    lines.push(
      `  CONSTRAINT ${q(fk.name)} FOREIGN KEY (${fk.columns.map(q).join(", ")}) ` +
        `REFERENCES ${q(fk.refTable)} (${fk.refColumns.map(q).join(", ")})`,
    );
  }
  const target = engine === "postgres" ? `${q(detail.schema)}.${q(detail.name)}` : q(detail.name);
  return `CREATE TABLE ${target} (\n${lines.join(",\n")}\n);`;
}
