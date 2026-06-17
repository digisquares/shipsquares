import postgres from "postgres";

import type { ConnectionConfig, DbDriver, QueryExecResult, TxStatement } from "./types.js";

// Postgres driver over postgres.js (already a control-plane dependency). Applies
// the connection's hard statement_timeout; `ssl: "require"` uses TLS without CA
// verification (arbitrary servers present self-signed certs). Values are bound
// via sql.unsafe(text, params); identifiers are pre-quoted by the SQL cores.

type PgResult = Array<Record<string, unknown>> & {
  columns?: { name: string; type: number }[];
  count?: number;
  command?: string;
};

function mapPg(res: PgResult): QueryExecResult {
  const rows = Array.from(res) as Record<string, unknown>[];
  return {
    fields: (res.columns ?? []).map((c) => ({ name: c.name, dataType: String(c.type) })),
    rows,
    rowCount: typeof res.count === "number" ? res.count : rows.length,
    command: res.command ?? "",
  };
}

export function makePostgresDriver(config: ConnectionConfig): DbDriver {
  const options = {
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.user,
    password: config.password,
    ssl: config.tls ? "require" : false,
    max: 3,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => undefined,
    connection: {
      statement_timeout: config.statementTimeoutMs,
      // Read-only connections enforce it at the session level too (a backstop
      // beyond the classifier): every backend starts default_transaction_read_only.
      ...(config.readOnly ? { default_transaction_read_only: true } : {}),
    },
  } as postgres.Options<Record<string, never>>;
  const sql = postgres(options);

  const query: DbDriver["query"] = async (text, params = []) =>
    mapPg((await sql.unsafe(text, params as never[])) as unknown as PgResult);

  return {
    engine: "postgres",
    query,
    async transaction(statements: TxStatement[]) {
      // sql.begin commits on resolve, rolls back if the callback throws.
      return (await sql.begin(async (tx) => {
        const out: QueryExecResult[] = [];
        for (const s of statements) {
          out.push(
            mapPg((await tx.unsafe(s.sql, (s.params ?? []) as never[])) as unknown as PgResult),
          );
        }
        return out;
      })) as unknown as QueryExecResult[];
    },
    async ping() {
      const r = await query("select version() as v");
      return { serverVersion: String(r.rows[0]?.v ?? "") };
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
