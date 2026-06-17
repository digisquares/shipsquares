import { createConnection, type Connection, type FieldPacket } from "mysql2/promise";

import type { ConnectionConfig, DbDriver, QueryExecResult, TxStatement } from "./types.js";

// MySQL/MariaDB driver over mysql2 (pure-JS — no native addon, so no bundle
// vendoring). Lazily opens one connection, reused across queries + transactions.
// dateStrings + bigNumberStrings keep results JSON-serializable for the grid.
// Uses `query` (text protocol) so LIMIT ? works across versions; values are
// bound, identifiers pre-quoted by the SQL cores. `ssl` allows self-signed.

function mapMy(result: unknown, fields: FieldPacket[] | undefined): QueryExecResult {
  if (Array.isArray(result)) {
    const rows = result as unknown as Record<string, unknown>[];
    return {
      fields: ((fields ?? []) as FieldPacket[]).map((f) => ({
        name: f.name,
        dataType: String((f as { type?: number }).type ?? ""),
      })),
      rows,
      rowCount: rows.length,
      command: "SELECT",
    };
  }
  const header = result as { affectedRows?: number };
  return { fields: [], rows: [], rowCount: header.affectedRows ?? 0, command: "WRITE" };
}

export function makeMysqlDriver(config: ConnectionConfig): DbDriver {
  let connPromise: Promise<Connection> | null = null;
  const conn = (): Promise<Connection> =>
    (connPromise ??= (async () => {
      const c = await createConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        ...(config.tls ? { ssl: { rejectUnauthorized: false } } : {}),
        connectTimeout: 10_000,
        multipleStatements: false,
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: true,
      });
      // Read-only connections enforce it at the session level too (a backstop
      // beyond the classifier): writes raise ER_CANT_EXECUTE_IN_READ_ONLY.
      if (config.readOnly) await c.query("SET SESSION TRANSACTION READ ONLY");
      return c;
    })());

  const query: DbDriver["query"] = async (text, params = []) => {
    const c = await conn();
    const [result, fields] = await c.query(
      { sql: text, timeout: config.statementTimeoutMs },
      params as never[],
    );
    return mapMy(result, fields as FieldPacket[]);
  };

  return {
    engine: "mysql",
    query,
    async transaction(statements: TxStatement[]) {
      const c = await conn();
      await c.beginTransaction();
      try {
        const out: QueryExecResult[] = [];
        for (const s of statements) {
          const [result, fields] = await c.query(
            { sql: s.sql, timeout: config.statementTimeoutMs },
            (s.params ?? []) as never[],
          );
          out.push(mapMy(result, fields as FieldPacket[]));
        }
        await c.commit();
        return out;
      } catch (e) {
        await c.rollback();
        throw e;
      }
    },
    async ping() {
      const r = await query("select version() as v");
      return { serverVersion: String(r.rows[0]?.v ?? "") };
    },
    async close() {
      if (connPromise) {
        const c = await connPromise;
        await c.end();
      }
    },
  };
}
