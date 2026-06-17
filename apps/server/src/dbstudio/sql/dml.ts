import { ValidationError } from "@ss/shared";

import type { DbEngine, TxStatement } from "../engines/types.js";

import { quoteIdent, quoteQualified } from "./quote.js";

// Structured row edits → PK-qualified, parameterized statements
// (database-studio/03-query-and-editing.md). The grid never sends raw SQL: it
// sends a RowEdit whose pk/values KEYS are column names (quoted here) and whose
// VALUES are bound params. update/delete refuse without a PK so an edit can
// never become an accidental mass mutation. Pure + unit-tested.

export type EditOp = "insert" | "update" | "delete";

export interface RowEdit {
  op: EditOp;
  schema: string;
  table: string;
  /** Identifying PK column→value map (update/delete); its keys ARE the PK. */
  pk?: Record<string, unknown>;
  /** Changed columns (update) or the new row (insert). */
  values?: Record<string, unknown>;
}

const placeholder = (engine: DbEngine, i: number): string =>
  engine === "postgres" ? `$${i}` : "?";

export function buildStatement(engine: DbEngine, edit: RowEdit): TxStatement {
  const from = quoteQualified(engine, [edit.schema, edit.table]);
  const values = edit.values ?? {};
  const pk = edit.pk ?? {};
  const params: unknown[] = [];
  const bind = (v: unknown): string => {
    params.push(v);
    return placeholder(engine, params.length);
  };

  if (edit.op === "insert") {
    const cols = Object.keys(values);
    if (cols.length === 0) throw new ValidationError("insert requires at least one column");
    const colSql = cols.map((c) => quoteIdent(engine, c)).join(", ");
    const valSql = cols.map((c) => bind(values[c])).join(", ");
    return { sql: `INSERT INTO ${from} (${colSql}) VALUES (${valSql})`, params };
  }

  const pkCols = Object.keys(pk);
  if (pkCols.length === 0) {
    throw new ValidationError(`${edit.op} requires a primary key (none supplied / table has none)`);
  }

  if (edit.op === "delete") {
    const where = pkCols.map((c) => `${quoteIdent(engine, c)} = ${bind(pk[c])}`).join(" AND ");
    return { sql: `DELETE FROM ${from} WHERE ${where}`, params };
  }

  // update
  const setCols = Object.keys(values);
  if (setCols.length === 0)
    throw new ValidationError("update requires at least one changed column");
  const setSql = setCols.map((c) => `${quoteIdent(engine, c)} = ${bind(values[c])}`).join(", ");
  const where = pkCols.map((c) => `${quoteIdent(engine, c)} = ${bind(pk[c])}`).join(" AND ");
  return { sql: `UPDATE ${from} SET ${setSql} WHERE ${where}`, params };
}
