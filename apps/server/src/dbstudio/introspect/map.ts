import type { DbEngine } from "../engines/types.js";

import { uiTypeFor } from "./type-map.js";
import type { ColumnInfo, ForeignKey, IndexInfo, SchemaNode, TableNode } from "./types.js";

/** Catalog booleans arrive as JS booleans (pglite/postgres.js) or 1/0/'t'
 *  (other drivers) — normalize to a boolean. */
export function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "t" || v === "true" || v === "1";
}

// Pure mappers: raw catalog rows (already normalized per engine) → the shared
// model (database-studio/02). Kept pure so they're unit-tested with fixtures
// while the live SQL is exercised by the pglite integration test.

export interface RawTable {
  schema: string;
  name: string;
  kind: "table" | "view";
  estimatedRows: number | null;
}

export function groupSchemas(rows: RawTable[]): SchemaNode[] {
  const bySchema = new Map<string, TableNode[]>();
  for (const r of rows) {
    const list = bySchema.get(r.schema) ?? [];
    list.push({ schema: r.schema, name: r.name, kind: r.kind, estimatedRows: r.estimatedRows });
    bySchema.set(r.schema, list);
  }
  return [...bySchema.entries()].map(([name, tables]) => ({ name, tables }));
}

export interface RawColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  default: string | null;
}

export function toColumnInfos(engine: DbEngine, raw: RawColumn[], pkCols: string[]): ColumnInfo[] {
  const pk = new Set(pkCols);
  return raw.map((c) => ({
    name: c.name,
    dataType: c.dataType,
    uiType: uiTypeFor(engine, c.dataType),
    nullable: c.nullable,
    default: c.default,
    isPrimaryKey: pk.has(c.name),
  }));
}

export interface RawFk {
  name: string;
  column: string;
  refSchema: string;
  refTable: string;
  refColumn: string;
}

/** Group per-constraint rows into FKs, deduping columns (composite-safe against
 *  the information_schema kcu×ccu cartesian). */
export function groupForeignKeys(rows: RawFk[]): ForeignKey[] {
  const byName = new Map<string, ForeignKey>();
  for (const r of rows) {
    let fk = byName.get(r.name);
    if (!fk) {
      fk = {
        name: r.name,
        columns: [],
        refSchema: r.refSchema,
        refTable: r.refTable,
        refColumns: [],
      };
      byName.set(r.name, fk);
    }
    if (!fk.columns.includes(r.column)) fk.columns.push(r.column);
    if (!fk.refColumns.includes(r.refColumn)) fk.refColumns.push(r.refColumn);
  }
  return [...byName.values()];
}

export interface RawIndex {
  name: string;
  column: string;
  unique: boolean;
  primary: boolean;
}

/** Group per-column index rows (already ordered by sequence) into IndexInfo,
 *  accumulating columns in order and deduping. */
export function groupIndexes(rows: RawIndex[]): IndexInfo[] {
  const byName = new Map<string, IndexInfo>();
  for (const r of rows) {
    let ix = byName.get(r.name);
    if (!ix) {
      ix = { name: r.name, columns: [], unique: r.unique, primary: r.primary };
      byName.set(r.name, ix);
    }
    if (!ix.columns.includes(r.column)) ix.columns.push(r.column);
  }
  return [...byName.values()];
}

/** reltuples / table_rows are estimates; negative/NaN → null (never use for paging). */
export function estimatedRows(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}
