// Client mirror of the Database Studio API shapes (apps/server/src/routes/dbstudio.ts).

export interface ConnectionView {
  id: string;
  source: "managed" | "external";
  name: string;
  engine: "postgres" | "mysql" | "mariadb";
  host: string;
  database: string;
  readOnly: boolean;
  appId: string | null;
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

export interface QueryField {
  name: string;
  dataType: string;
}

export interface RowsPage {
  fields: QueryField[];
  rows: Record<string, unknown>[];
  primaryKey: string[];
  page: { limit: number; offset: number; hasMore: boolean };
}

export type SortDir = "asc" | "desc";
export interface Sort {
  column: string;
  dir: SortDir;
}

// Table structure (GET /db-connections/:id/tables/:schema/:table) — mirrors the
// server's normalized introspection model.
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
  dataType: string;
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
export interface TableDetail {
  schema: string;
  name: string;
  columns: ColumnInfo[];
  primaryKey: string[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKey[];
}

/** A pending row edit accumulated in the commit bar: its PK + changed columns. */
export interface PendingEdit {
  pk: Record<string, unknown>;
  values: Record<string, unknown>;
}

/** Stable key for a row from its primary-key values — shared by the grid and the
 *  page's pending-edit map so a cell edit maps back to exactly one row. */
export const rowKeyOf = (primaryKey: string[], row: Record<string, unknown>): string =>
  JSON.stringify(primaryKey.map((c) => row[c] ?? null));
