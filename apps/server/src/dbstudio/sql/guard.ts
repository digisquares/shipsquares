// SQL statement classification + guarding for the Database Studio runner
// (database-studio/03-query-and-editing.md). A comment/string-aware pass (NOT a
// raw regex) so a keyword inside a literal or comment is never misread; anything
// ambiguous is "unknown" and treated as non-read (denied on a read-only
// connection). Pure + exhaustively unit-tested — this is the read-only boundary.

export type StatementClass = "read" | "write" | "ddl" | "unknown";

export interface StatementAnalysis {
  statementClass: StatementClass;
  destructive: boolean; // DROP/TRUNCATE/ALTER/RENAME, or UPDATE/DELETE without WHERE
  missingWhere: boolean; // an UPDATE/DELETE with no WHERE clause
  statementCount: number;
}

/** Replace comment + string/identifier-literal contents with spaces so keyword
 *  scanning only sees real SQL. Handles --, block comments, and '…'/"…"/`…`
 *  closed by a matching quote, with doubled-quote escaping (`''`).
 *
 *  Backslash is deliberately NOT treated as a string escape: Postgres with the
 *  default `standard_conforming_strings=on` does not honour it, so treating `\'`
 *  as an escape made the scanner run past a string's real end and swallow the
 *  rest of a multi-statement batch — e.g. `select '\';drop table t--'` looked
 *  like one read statement (a viewer→arbitrary-DDL bypass). Closing at the first
 *  matching quote errs toward *seeing more* statements, the safe direction for a
 *  read-only boundary (MySQL backslash-escapes may over-count, which only
 *  over-denies — never under-classifies a write as a read). */
export function stripNoise(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i]!;
    const c2 = sql[i + 1];
    if (c === "-" && c2 === "-") {
      i += 2;
      while (i < n && sql[i] !== "\n") i += 1;
      out += " ";
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const q = c;
      i += 1;
      while (i < n) {
        if (sql[i] === q) {
          if (sql[i + 1] === q) {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      out += " ";
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const READ_KW = new Set([
  "select",
  "with",
  "show",
  "explain",
  "describe",
  "desc",
  "table",
  "values",
  "pragma",
]);
const WRITE_KW = new Set([
  "insert",
  "update",
  "delete",
  "merge",
  "replace",
  "upsert",
  "call",
  "do",
  "copy",
  "load",
]);
const DDL_KW = new Set([
  "create",
  "alter",
  "drop",
  "truncate",
  "rename",
  "grant",
  "revoke",
  "comment",
  "vacuum",
  "analyze",
  "reindex",
  "cluster",
  "lock",
]);

function firstKeyword(stmt: string): string {
  const m = /^\s*([a-z_]+)/i.exec(stmt);
  return m ? m[1]!.toLowerCase() : "";
}

type OneClass = { cls: StatementClass; destructive: boolean; missingWhere: boolean };

const READ_ONE: OneClass = { cls: "read", destructive: false, missingWhere: false };

/** EXPLAIN is a read ONLY when it just plans. `EXPLAIN ANALYZE <write>` (and the
 *  parenthesised `EXPLAIN (ANALYZE) <write>`) actually EXECUTES the inner
 *  statement in Postgres, so it must inherit the inner statement's class — else a
 *  viewer runs writes/DDL under a "read". We unwrap the EXPLAIN prefix, note
 *  whether ANALYZE is present, then classify the inner statement; a plain
 *  (non-analyze) EXPLAIN of a write stays a read (planning only). */
function classifyExplain(stmt: string): OneClass {
  const m = /^\s*explain\s+/i.exec(stmt);
  if (!m) return READ_ONE;
  let rest = stmt.slice(m[0].length);
  let analyze = false;
  if (rest.startsWith("(")) {
    const close = rest.indexOf(")");
    if (close === -1) return READ_ONE; // malformed → planning-only read
    if (/\banalyze\b/i.test(rest.slice(1, close))) analyze = true;
    rest = rest.slice(close + 1).trimStart();
  } else {
    // Legacy bare form: EXPLAIN [ANALYZE] [VERBOSE] <statement>
    let opt: RegExpExecArray | null;
    const OPT = /^(analyze|verbose)\b\s*/i;
    while ((opt = OPT.exec(rest))) {
      if (/analyze/i.test(opt[1]!)) analyze = true;
      rest = rest.slice(opt[0].length);
    }
  }
  const inner = classifyOne(rest);
  if (inner.cls === "read") return READ_ONE;
  if (inner.cls === "unknown") return inner; // conservative: deny on read-only
  // A write/ddl inner executes only under ANALYZE; otherwise it's planning-only.
  return analyze ? inner : READ_ONE;
}

function classifyOne(stmt: string): OneClass {
  const kw = firstKeyword(stmt);
  const lower = stmt.toLowerCase();
  if (kw === "explain") return classifyExplain(stmt);
  let cls: StatementClass;
  if (READ_KW.has(kw)) {
    // A data-modifying CTE (WITH … INSERT/UPDATE/DELETE) is a write.
    cls = kw === "with" && /\b(insert|update|delete|merge)\b/.test(lower) ? "write" : "read";
  } else if (WRITE_KW.has(kw)) {
    cls = "write";
  } else if (DDL_KW.has(kw)) {
    cls = "ddl";
  } else {
    cls = "unknown";
  }
  const missingWhere = (kw === "update" || kw === "delete") && !/\bwhere\b/.test(lower);
  const destructive =
    kw === "drop" || kw === "truncate" || kw === "alter" || kw === "rename" || missingWhere;
  return { cls, destructive, missingWhere };
}

export function classify(sql: string): StatementAnalysis {
  const stmts = stripNoise(sql)
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (stmts.length === 0) {
    return { statementClass: "read", destructive: false, missingWhere: false, statementCount: 0 };
  }
  const parts = stmts.map(classifyOne);
  const statementClass: StatementClass = parts.some((p) => p.cls === "ddl")
    ? "ddl"
    : parts.some((p) => p.cls === "unknown")
      ? "unknown"
      : parts.some((p) => p.cls === "write")
        ? "write"
        : "read";
  return {
    statementClass,
    destructive: parts.some((p) => p.destructive),
    missingWhere: parts.some((p) => p.missingWhere),
    statementCount: stmts.length,
  };
}

/** Append a LIMIT to a single bare SELECT/WITH that lacks one (best-effort,
 *  identical syntax for PG + MySQL). Leaves multi-statement, non-read, SHOW/
 *  EXPLAIN, or already-limited SQL untouched; the driver row cap is the backstop. */
export function enforceRowLimit(sql: string, maxRows: number): string {
  const a = classify(sql);
  if (a.statementCount !== 1 || a.statementClass !== "read") return sql;
  const stripped = stripNoise(sql);
  const kw = firstKeyword(stripped);
  if (kw !== "select" && kw !== "with") return sql;
  if (/\blimit\b/i.test(stripped) || /\bfetch\b/i.test(stripped)) return sql;
  const trimmed = sql.replace(/;\s*$/, "").trimEnd();
  return `${trimmed} LIMIT ${Math.max(1, Math.floor(maxRows))}`;
}
