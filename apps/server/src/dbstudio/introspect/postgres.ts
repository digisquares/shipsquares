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

// Postgres introspection over information_schema (+ pg_class for row estimates).
// Uses only portable catalog views so it runs identically on a real server and
// on in-process pglite (the integration test). Identifiers are bound params.

const SCHEMAS_SQL = `
  SELECT t.table_schema AS schema, t.table_name AS name,
         CASE WHEN t.table_type = 'VIEW' THEN 'view' ELSE 'table' END AS kind,
         c.reltuples AS est
  FROM information_schema.tables t
  LEFT JOIN pg_namespace n ON n.nspname = t.table_schema
  LEFT JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = n.oid
  WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY t.table_schema, t.table_name`;

const COLUMNS_SQL = `
  SELECT column_name AS name, data_type AS data_type,
         is_nullable AS is_nullable, column_default AS default_expr
  FROM information_schema.columns
  WHERE table_schema = $1 AND table_name = $2
  ORDER BY ordinal_position`;

const PK_SQL = `
  SELECT kcu.column_name AS col
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2
  ORDER BY kcu.ordinal_position`;

const FK_SQL = `
  SELECT tc.constraint_name AS name, kcu.column_name AS col,
         ccu.table_schema AS ref_schema, ccu.table_name AS ref_table, ccu.column_name AS ref_col
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2
  ORDER BY tc.constraint_name, kcu.ordinal_position`;

const INDEX_SQL = `
  SELECT i.relname AS name, ix.indisunique AS is_unique, ix.indisprimary AS is_primary,
         a.attname AS col, k.ord AS seq
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class t ON t.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
  WHERE n.nspname = $1 AND t.relname = $2 AND k.attnum <> 0
  ORDER BY i.relname, k.ord`;

export async function pgSchemas(q: QueryFn): Promise<SchemaNode[]> {
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

export async function pgTableDetail(
  q: QueryFn,
  schema: string,
  table: string,
): Promise<TableDetail> {
  const [cols, pk, fk, idx] = await Promise.all([
    q(COLUMNS_SQL, [schema, table]),
    q(PK_SQL, [schema, table]),
    q(FK_SQL, [schema, table]),
    q(INDEX_SQL, [schema, table]),
  ]);
  const raw: RawColumn[] = cols.rows.map((r) => ({
    name: String(r.name),
    dataType: String(r.data_type),
    nullable: String(r.is_nullable) === "YES",
    default: r.default_expr == null ? null : String(r.default_expr),
  }));
  const primaryKey = pk.rows.map((r) => String(r.col));
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
      primary: truthy(r.is_primary),
    })),
  );
  return {
    schema,
    name: table,
    columns: toColumnInfos("postgres", raw, primaryKey),
    primaryKey,
    indexes,
    foreignKeys,
  };
}
