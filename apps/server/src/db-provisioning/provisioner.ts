import { quoteIdentifier } from "./identifiers.js";

// Database/role provisioning against the managed Postgres
// (24-database-servers.md). Statement composition is pure and strict:
// identifiers go through the validated quoter (injection-by-name is rejected,
// never executed) and the password literal is single-quote-escaped (DDL can't
// be parameterized). The executor is injected — postgres.js with the admin
// credentials at runtime, a mock in tests.

export interface ProvisionInput {
  database: string;
  user: string;
  password: string;
}

const sqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export function provisionStatements(input: ProvisionInput): string[] {
  const db = quoteIdentifier(input.database);
  const role = quoteIdentifier(input.user);
  return [
    `CREATE ROLE ${role} WITH LOGIN PASSWORD ${sqlLiteral(input.password)}`,
    `CREATE DATABASE ${db} OWNER ${role}`,
    // Owner-only by default: no PUBLIC connect/temp on the new database.
    `REVOKE ALL ON DATABASE ${db} FROM PUBLIC`,
  ];
}

export function dropStatements(input: { database: string; user: string }): string[] {
  return [
    `DROP DATABASE IF EXISTS ${quoteIdentifier(input.database)}`,
    `DROP ROLE IF EXISTS ${quoteIdentifier(input.user)}`,
  ];
}

export interface ProvisionResult {
  ok: boolean;
  error?: string;
}

export type AdminExec = (sql: string) => Promise<unknown>;

/** Run the provisioning sequence; stops at the first failure and names the
 *  failing statement (sans the password literal) in the error. */
export async function provisionDatabase(
  input: ProvisionInput,
  exec: AdminExec,
): Promise<ProvisionResult> {
  for (const stmt of provisionStatements(input)) {
    try {
      await exec(stmt);
    } catch (e) {
      const head = stmt.split(" WITH ")[0]; // never echo the password literal
      const cause = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `${head} failed: ${cause}` };
    }
  }
  return { ok: true };
}
