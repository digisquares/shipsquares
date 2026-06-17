import type { DbEngine } from "../engines/types.js";

import type { UiType } from "./types.js";

// Best-effort engine-type → UI-type mapping (database-studio/02). Drives grid
// rendering + (later) inline-edit input types. Pure + table-driven so it's
// trivially testable; unknown types fall back to "other" (mono, read-only-inline).

export function pgUiType(dataType: string): UiType {
  const t = dataType.toLowerCase();
  if (t === "boolean") return "boolean";
  if (
    /^(smallint|integer|bigint|numeric|decimal|real|double precision|money|serial|bigserial)/.test(
      t,
    )
  )
    return "number";
  if (t.startsWith("timestamp") || t === "date" || t.startsWith("time")) return "datetime";
  if (t === "json" || t === "jsonb") return "json";
  if (t === "uuid") return "uuid";
  if (t === "bytea") return "bytes";
  if (t === "user-defined") return "enum"; // pg enums surface as USER-DEFINED in information_schema
  if (t.includes("char") || t === "text" || t === "name" || t === "citext") return "string";
  return "other";
}

export function mysqlUiType(columnType: string): UiType {
  const t = columnType.toLowerCase();
  if (t.startsWith("tinyint(1)")) return "boolean";
  if (
    /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|dec|numeric|fixed|float|double|bit)/.test(
      t,
    )
  )
    return "number";
  if (/^(datetime|timestamp|date|time|year)/.test(t)) return "datetime";
  if (t.startsWith("json")) return "json";
  if (t.startsWith("enum") || t.startsWith("set")) return "enum";
  if (/(blob|binary)/.test(t)) return "bytes";
  if (t.includes("char") || t.includes("text")) return "string";
  return "other";
}

export function uiTypeFor(engine: DbEngine, dataType: string): UiType {
  return engine === "mysql" ? mysqlUiType(dataType) : pgUiType(dataType);
}
