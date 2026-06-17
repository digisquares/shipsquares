import { NotFoundError } from "@ss/shared";
import { and, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { databaseServers, databaseUsers, databases, dbConnections } from "../db/schema/index.js";

import type { ConnectionConfig, DbEngine } from "./engines/types.js";

// Turn an opaque connection id into a driver config + opened credentials, for
// both pillars (database-studio/01-architecture.md):
//   ext:<dbc_…>     → a saved external profile (password opened from its sealed ref)
//   managed:<db_…>  → synthesized from database_servers/databases/database_users
// Org-scoped: a cross-tenant id resolves to 404. `openSecret` is injected so
// resolution is unit-testable without a real master key.

export type ConnSource = "managed" | "external";

export interface ResolvedConnection {
  id: string;
  source: ConnSource;
  label: string;
  config: ConnectionConfig;
  readOnly: boolean;
}

export interface ResolveDeps {
  openSecret: (ref: string) => string;
  /** SSRF re-validation at resolve time (DNS-rebinding/TOCTOU-safe): external
   *  hosts are re-checked on every open, not only at create. Managed hosts are
   *  trusted infra and skip it (database-studio/04). */
  assertHost: (host: string) => Promise<void>;
  defaults: { statementTimeoutMs: number; maxRows: number };
}

/** mariadb → the mysql driver; everything non-postgres is treated as mysql. */
const driverEngine = (engine: string): DbEngine => (engine === "postgres" ? "postgres" : "mysql");

export function parseConnectionId(connectionId: string): { source: ConnSource; ref: string } {
  const idx = connectionId.indexOf(":");
  const prefix = idx === -1 ? "" : connectionId.slice(0, idx);
  const ref = idx === -1 ? "" : connectionId.slice(idx + 1);
  if (prefix === "managed" && ref) return { source: "managed", ref };
  if (prefix === "ext" && ref) return { source: "external", ref };
  throw new NotFoundError("connection not found");
}

export async function resolveConnection(
  db: Db,
  orgId: string,
  connectionId: string,
  deps: ResolveDeps,
): Promise<ResolvedConnection> {
  const { source, ref } = parseConnectionId(connectionId);
  return source === "external"
    ? resolveExternal(db, orgId, ref, deps)
    : resolveManaged(db, orgId, ref, deps);
}

async function resolveExternal(
  db: Db,
  orgId: string,
  id: string,
  deps: ResolveDeps,
): Promise<ResolvedConnection> {
  const row = (
    await db
      .select()
      .from(dbConnections)
      .where(and(eq(dbConnections.id, id), eq(dbConnections.organizationId, orgId)))
      .limit(1)
  )[0];
  if (!row) throw new NotFoundError("connection not found");
  await deps.assertHost(row.host); // SSRF re-check on every open (rebinding-safe)
  return {
    id: `ext:${row.id}`,
    source: "external",
    label: row.name,
    readOnly: row.readOnly,
    config: {
      engine: driverEngine(row.engine),
      host: row.host,
      port: row.port,
      database: row.database,
      user: row.username,
      password: deps.openSecret(row.passwordSecretRef),
      tls: row.tls,
      readOnly: row.readOnly,
      ...deps.defaults,
    },
  };
}

async function resolveManaged(
  db: Db,
  orgId: string,
  databaseId: string,
  deps: ResolveDeps,
): Promise<ResolvedConnection> {
  const target = (
    await db
      .select()
      .from(databases)
      .where(and(eq(databases.id, databaseId), eq(databases.organizationId, orgId)))
      .limit(1)
  )[0];
  if (!target) throw new NotFoundError("connection not found");
  const server = (
    await db.select().from(databaseServers).where(eq(databaseServers.id, target.serverId)).limit(1)
  )[0];
  if (!server) throw new NotFoundError("connection not found");

  // Prefer the least-privileged provisioned user; fall back to the server's
  // admin URL credentials (parsed) when no per-database user exists.
  const dbUser = (
    await db
      .select()
      .from(databaseUsers)
      .where(and(eq(databaseUsers.serverId, server.id), eq(databaseUsers.databaseId, target.id)))
      .limit(1)
  )[0];
  let user: string;
  let password: string;
  if (dbUser) {
    user = dbUser.username;
    password = deps.openSecret(dbUser.passwordSecretRef);
  } else {
    const admin = parseUrlCreds(deps.openSecret(server.adminSecretRef));
    user = admin.user;
    password = admin.password;
  }

  return {
    id: `managed:${target.id}`,
    source: "managed",
    label: target.name,
    readOnly: true, // managed browse is read-only in R(db).1 (write lands in R(db).2)
    config: {
      engine: driverEngine(server.engine),
      host: server.host,
      port: server.port,
      database: target.name,
      user,
      password,
      tls: server.tls,
      readOnly: true,
      ...deps.defaults,
    },
  };
}

function parseUrlCreds(url: string): { user: string; password: string } {
  try {
    const u = new URL(url);
    return { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
  } catch {
    return { user: "", password: "" };
  }
}
