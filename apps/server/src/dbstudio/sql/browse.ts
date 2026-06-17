import { ValidationError } from "@ss/shared";

import type { DbEngine } from "../engines/types.js";
import type { BrowseSpec, ColumnInfo } from "../introspect/types.js";

import { quoteIdent, quoteQualified } from "./quote.js";

// Validated, parameterized SELECT builder for the browse grid
// (database-studio/02). The SELECT is built from the INTROSPECTED column list —
// never client-supplied SQL — and sort/filter columns are validated to exist
// (unknown column → ValidationError, not injection). Values are bound; only the
// validated identifiers are interpolated (via quote.ts). Comparison ops use a
// text cast so arbitrary column types don't error; ordered ops (lt/gt) are
// deferred to a later slice.

export interface BuiltQuery {
  sql: string;
  params: unknown[];
  /** Effective row cap (min(requested, maxRows)); the query asks for +1 to detect hasMore. */
  appliedLimit: number;
}

const placeholder = (engine: DbEngine, i: number): string =>
  engine === "postgres" ? `$${i}` : "?";

export function buildBrowseQuery(
  engine: DbEngine,
  spec: BrowseSpec,
  columns: ColumnInfo[],
  maxRows: number,
): BuiltQuery {
  if (columns.length === 0) throw new ValidationError("table has no columns");
  const names = new Set(columns.map((c) => c.name));
  const qcols = columns.map((c) => quoteIdent(engine, c.name)).join(", ");
  const from = quoteQualified(engine, [spec.schema, spec.table]);

  const params: unknown[] = [];
  const where: string[] = [];
  for (const f of spec.filters ?? []) {
    if (!names.has(f.column)) throw new ValidationError(`unknown filter column: ${f.column}`);
    const col = quoteIdent(engine, f.column);
    const asText = engine === "postgres" ? `${col}::text` : `CAST(${col} AS CHAR)`;
    if (f.op === "isnull") {
      where.push(`${col} IS NULL`);
    } else if (f.op === "notnull") {
      where.push(`${col} IS NOT NULL`);
    } else if (f.op === "eq") {
      params.push(f.value ?? "");
      where.push(`${asText} = ${placeholder(engine, params.length)}`);
    } else if (f.op === "ne") {
      params.push(f.value ?? "");
      where.push(`${asText} <> ${placeholder(engine, params.length)}`);
    } else if (f.op === "like") {
      params.push(`%${f.value ?? ""}%`);
      const ph = placeholder(engine, params.length);
      where.push(engine === "postgres" ? `${asText} ILIKE ${ph}` : `${asText} LIKE ${ph}`);
    } else {
      throw new ValidationError(`unsupported filter op: ${String(f.op)}`);
    }
  }

  let sql = `SELECT ${qcols} FROM ${from}`;
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  if (spec.sort) {
    if (!names.has(spec.sort.column)) {
      throw new ValidationError(`unknown sort column: ${spec.sort.column}`);
    }
    const dir = spec.sort.dir === "desc" ? "DESC" : "ASC";
    sql += ` ORDER BY ${quoteIdent(engine, spec.sort.column)} ${dir}`;
  }

  const appliedLimit = Math.max(1, Math.min(Math.floor(spec.limit), maxRows));
  params.push(appliedLimit + 1); // +1 row to detect hasMore
  sql += ` LIMIT ${placeholder(engine, params.length)}`;
  const offset = Math.max(0, Math.floor(spec.offset || 0));
  if (offset > 0) {
    params.push(offset);
    sql += ` OFFSET ${placeholder(engine, params.length)}`;
  }
  return { sql, params, appliedLimit };
}
