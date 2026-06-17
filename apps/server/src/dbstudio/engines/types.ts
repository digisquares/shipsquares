// Engine-driver contracts for the Database Studio
// (database-studio/01-architecture.md). A driver is the ONLY place a real DB
// socket is opened; everything above it builds SQL (pure) and consumes a
// QueryFn. The browser never reaches a driver — the control plane proxies.

export type DbEngine = "postgres" | "mysql";

export interface ConnectionConfig {
  engine: DbEngine;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  tls: boolean;
  /** Hard ceiling the driver applies regardless of caller. */
  statementTimeoutMs: number;
  /** Hard row ceiling for browse pages. */
  maxRows: number;
  /** Open DB sessions read-only — a server-side backstop beyond the SQL
   *  classifier (database-studio/03). Writable connections set this false. */
  readOnly: boolean;
}

export interface QueryField {
  name: string;
  /** Engine type name/oid as a string; the grid prefers introspected types. */
  dataType: string;
}

export interface QueryExecResult {
  fields: QueryField[];
  rows: Record<string, unknown>[];
  rowCount: number;
  command: string;
}

/** A SQL-runner result: an exec result plus timing + whether the row cap clipped it. */
export interface QueryRunResult extends QueryExecResult {
  elapsedMs: number;
  truncated: boolean;
}

/** The seam introspection + browse build on: run SQL, get rows back. A driver's
 *  `query` satisfies this; tests pass a pglite-backed fake. */
export type QueryFn = (sql: string, params?: unknown[]) => Promise<QueryExecResult>;

/** One statement in a transaction batch (the commit-bar row edits). */
export interface TxStatement {
  sql: string;
  params?: unknown[];
}

export interface DbDriver {
  readonly engine: DbEngine;
  ping(): Promise<{ serverVersion: string }>;
  query: QueryFn;
  /** Run statements atomically (BEGIN → … → COMMIT; ROLLBACK on any error). */
  transaction(statements: TxStatement[]): Promise<QueryExecResult[]>;
  close(): Promise<void>;
}

export type DriverFactory = (config: ConnectionConfig) => DbDriver;
