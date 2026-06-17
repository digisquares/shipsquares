import type { QueryFn } from "../engines/types.js";

import {
  estimatedRows,
  groupForeignKeys,
  groupIndexes,
  groupSchemas,
  toColumnInfos,
  truthy,
  type RawColumn,
} from "./map.js";
import type { SchemaNode, TableDetail } from "./types.js";

// MySQL/MariaDB introspection over information_schema. PK is read from
// COLUMNS.column_key ('PRI') — no separate query. Identifiers are bound params.
// (No server in unit CI: the mappers above are fixture-tested; the live SQL is
// covered by the gated MySQL suite / VM validation per 06-testing-and-rollout.)

const SCHEMAS_SQL = `
  SELECT table_schema AS \`schema\`, table_name AS name,
         CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END AS kind,
         table_rows AS est
  FROM information_schema.tables
  WHERE table_schema NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
  ORDER BY table_schema, table_name`;

const COLUMNS_SQL = `
  SELECT column_name AS name, column_type AS data_type, is_nullable AS is_nullable,
         column_default AS default_expr, column_key AS column_key
  FROM information_schema.columns
  WHERE table_schema = ? AND table_name = ?
  ORDER BY ordinal_position`;

const FK_SQL = `
  SELECT constraint_name AS name, column_name AS col,
         referenced_table_schema AS ref_schema, referenced_table_name AS ref_table,
         referenced_column_name AS ref_col
  FROM information_schema.key_column_usage
  WHERE table_schema = ? AND table_name = ? AND referenced_table_name IS NOT NULL
  ORDER BY constraint_name, ordinal_position`;

const INDEX_SQL = `
  SELECT index_name AS name, column_name AS col,
         (non_unique = 0) AS is_unique, seq_in_index AS seq
  FROM information_schema.statistics
  WHERE table_schema = ? AND table_name = ?
  ORDER BY index_name, seq_in_index`;

export async function mysqlSchemas(q: QueryFn): Promise<SchemaNode[]> {
  const res = await q(SCHEMAS_SQL);
  return groupSchemas(
    res.rows.map((r) => ({
      schema: String(r.schema),
      name: String(r.name),
      kind: r.kind === "view" ? "view" : "table",
      estimatedRows: estimatedRows(r.est),
    })),
  );
}

export async function mysqlTableDetail(
  q: QueryFn,
  schema: string,
  table: string,
): Promise<TableDetail> {
  const [cols, fk, idx] = await Promise.all([
    q(COLUMNS_SQL, [schema, table]),
    q(FK_SQL, [schema, table]),
    q(INDEX_SQL, [schema, table]),
  ]);
  const raw: RawColumn[] = cols.rows.map((r) => ({
    name: String(r.name),
    dataType: String(r.data_type),
    nullable: String(r.is_nullable) === "YES",
    default: r.default_expr == null ? null : String(r.default_expr),
  }));
  const primaryKey = cols.rows
    .filter((r) => String(r.column_key) === "PRI")
    .map((r) => String(r.name));
  const foreignKeys = groupForeignKeys(
    fk.rows.map((r) => ({
      name: String(r.name),
      column: String(r.col),
      refSchema: String(r.ref_schema),
      refTable: String(r.ref_table),
      refColumn: String(r.ref_col),
    })),
  );
  const indexes = groupIndexes(
    idx.rows.map((r) => ({
      name: String(r.name),
      column: String(r.col),
      unique: truthy(r.is_unique),
      primary: String(r.name) === "PRIMARY",
    })),
  );
  return {
    schema,
    name: table,
    columns: toColumnInfos("mysql", raw, primaryKey),
    primaryKey,
    indexes,
    foreignKeys,
  };
}
