// Normalized, engine-agnostic introspection + browse model
// (database-studio/02-data-model-and-introspection.md). PG schemas and MySQL
// databases both flatten into SchemaNode; the frontend renders these directly.

import type { DbEngine, QueryField } from "../engines/types.js";

export type UiType =
  | "number"
  | "string"
  | "boolean"
  | "datetime"
  | "json"
  | "uuid"
  | "bytes"
  | "enum"
  | "other";

export interface ColumnInfo {
  name: string;
  dataType: string; // engine type, e.g. "integer", "varchar(255)"
  uiType: UiType;
  nullable: boolean;
  default: string | null;
  isPrimaryKey: boolean;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}

export interface ForeignKey {
  name: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
}

export interface TableNode {
  schema: string;
  name: string;
  kind: "table" | "view";
  estimatedRows: number | null;
}

export interface SchemaNode {
  name: string;
  tables: TableNode[];
}

export interface TableDetail {
  schema: string;
  name: string;
  columns: ColumnInfo[];
  primaryKey: string[]; // [] → not inline-editable
  indexes: IndexInfo[];
  foreignKeys: ForeignKey[];
}

// ── Browse (row paging) ─────────────────────────────────────────────────────

export type FilterOp = "eq" | "ne" | "like" | "isnull" | "notnull";

export interface BrowseFilter {
  column: string;
  op: FilterOp;
  value?: string;
}

export interface BrowseSpec {
  schema: string;
  table: string;
  limit: number;
  offset: number;
  sort?: { column: string; dir: "asc" | "desc" };
  filters?: BrowseFilter[];
}

export interface RowsPage {
  fields: QueryField[];
  rows: Record<string, unknown>[];
  primaryKey: string[];
  page: { limit: number; offset: number; hasMore: boolean };
}

/** An introspector composes engine SQL + mappers over an injected QueryFn. */
export interface Introspector {
  readonly engine: DbEngine;
}
