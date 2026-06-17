import type { DbEngine } from "../engines/types.js";

// Identifier quoting — the SQL-injection boundary for the Database Studio
// (database-studio/03-query-and-editing.md). VALUES are always bound params;
// only identifiers (schema/table/column names) are ever interpolated, and only
// through here. Quoting (doubling the engine's quote char) is the correctness
// boundary — no character allow-listing — and is tested against adversarial idents.

export function quoteIdent(engine: DbEngine, ident: string): string {
  if (ident.length === 0) throw new Error("empty identifier");
  if (ident.includes("\0")) throw new Error("identifier contains a NUL byte");
  if (engine === "mysql") return `\`${ident.replaceAll("`", "``")}\``;
  return `"${ident.replaceAll('"', '""')}"`;
}

/** Quote a possibly-qualified name, e.g. ["public","users"] → "public"."users". */
export function quoteQualified(engine: DbEngine, parts: string[]): string {
  return parts.map((p) => quoteIdent(engine, p)).join(".");
}
