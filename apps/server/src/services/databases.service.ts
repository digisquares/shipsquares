import { randomBytes } from "node:crypto";

import { AppError, NotFoundError, ValidationError, newId } from "@ss/shared";
import type { Env } from "@ss/shared";
import { and, desc, eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "../db/index.js";
import { databaseServers, databaseUsers, databases } from "../db/schema/index.js";
import { buildConnectionString } from "../db-provisioning/connection.js";
import { isValidIdentifier } from "../db-provisioning/identifiers.js";
import { dropStatements, provisionDatabase } from "../db-provisioning/provisioner.js";
import { dbStudioPool, type DbStudioPool } from "../dbstudio/pool.js";
import { loadMasterKey, open, seal } from "../secrets/crypto.js";
import type { SealedValue } from "../secrets/types.js";

// Managed database servers + provisioned databases (24-database-servers.md):
// register a Postgres (admin URL sealed at rest), provision databases/roles on
// it through the tested engine, hand the connection string back EXACTLY ONCE.
// Views never expose sealed refs. Runtime SQL goes over a one-shot postgres.js
// admin connection (typecheck-gated here; no managed PG in the unit env).
const KEY_VERSION = 1;

function masterKey(config: Env): Buffer {
  try {
    return loadMasterKey(config.SHIPSQUARES_MASTER_KEY);
  } catch {
    throw new AppError("database provisioning requires SHIPSQUARES_MASTER_KEY", {
      status: 400,
      code: "secrets.unconfigured",
    });
  }
}
const sealStr = (plain: string, config: Env): string =>
  JSON.stringify(seal(plain, masterKey(config), KEY_VERSION));
const openStr = (s: string, config: Env): string =>
  open(JSON.parse(s) as SealedValue, masterKey(config));

type ServerRow = typeof databaseServers.$inferSelect;
type DatabaseRow = typeof databases.$inferSelect;

export interface ServerView {
  id: string;
  engine: string;
  host: string;
  port: number;
  isDefault: boolean;
  tls: boolean;
  createdAt: string;
}

export function toServerView(r: ServerRow): ServerView {
  return {
    id: r.id,
    engine: r.engine,
    host: r.host,
    port: r.port,
    isDefault: r.isDefault,
    tls: r.tls,
    createdAt: r.createdAt.toISOString(),
  };
}

export interface DatabaseView {
  id: string;
  serverId: string;
  name: string;
  ownerRole: string;
  appId: string | null;
  createdAt: string;
}

export function toDatabaseView(r: DatabaseRow): DatabaseView {
  return {
    id: r.id,
    serverId: r.serverId,
    name: r.name,
    ownerRole: r.ownerRole,
    appId: r.appId,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listServers(db: Db, orgId: string): Promise<ServerView[]> {
  const rows = await db
    .select()
    .from(databaseServers)
    .where(eq(databaseServers.organizationId, orgId))
    .orderBy(desc(databaseServers.createdAt));
  return rows.map(toServerView);
}

export async function registerServer(
  db: Db,
  config: Env,
  orgId: string,
  input: { host: string; port?: number; adminUrl: string; isDefault?: boolean; tls?: boolean },
): Promise<ServerView> {
  const rows = await db
    .insert(databaseServers)
    .values({
      id: newId("dbs"),
      organizationId: orgId,
      host: input.host,
      port: input.port ?? 5432,
      adminSecretRef: sealStr(input.adminUrl, config),
      isDefault: input.isDefault ?? false,
      tls: input.tls ?? true,
    })
    .returning();
  return toServerView(rows[0]!);
}

export async function deleteServer(db: Db, orgId: string, id: string): Promise<void> {
  const rows = await db
    .delete(databaseServers)
    .where(and(eq(databaseServers.id, id), eq(databaseServers.organizationId, orgId)))
    .returning({ id: databaseServers.id });
  if (!rows[0]) throw new NotFoundError("database server not found");
}

export async function listDatabases(db: Db, orgId: string): Promise<DatabaseView[]> {
  const rows = await db
    .select()
    .from(databases)
    .where(eq(databases.organizationId, orgId))
    .orderBy(desc(databases.createdAt));
  return rows.map(toDatabaseView);
}

async function serverRow(db: Db, orgId: string, serverId: string): Promise<ServerRow> {
  const rows = await db
    .select()
    .from(databaseServers)
    .where(and(eq(databaseServers.id, serverId), eq(databaseServers.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("database server not found");
  return rows[0];
}

/** Resolve a managed server's (org-scoped) admin connection URL for sibling
 *  services that need direct admin SQL access — e.g. DB performance diagnostics.
 *  Opening the sealed ref stays here so secret handling lives in one place. */
export async function getServerAdminUrl(
  db: Db,
  config: Env,
  orgId: string,
  serverId: string,
): Promise<string> {
  const server = await serverRow(db, orgId, serverId);
  if (server.engine !== "postgres") {
    throw new ValidationError("only postgres servers expose performance stats");
  }
  return openStr(server.adminSecretRef, config);
}

/** Run a provisioning sequence over a one-shot admin connection. */
async function withAdmin<T>(
  adminUrl: string,
  fn: (exec: (s: string) => Promise<unknown>) => Promise<T>,
): Promise<T> {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  try {
    return await fn((stmt) => sql.unsafe(stmt));
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

export interface ProvisionedDatabase {
  database: DatabaseView;
  /** returned exactly once — not retrievable later */
  connectionString: string;
}

export async function createDatabase(
  db: Db,
  config: Env,
  orgId: string,
  input: { serverId: string; name: string; appId?: string },
): Promise<ProvisionedDatabase> {
  const server = await serverRow(db, orgId, input.serverId);
  if (server.engine !== "postgres") {
    throw new ValidationError("only postgres servers support provisioning today");
  }
  // Validate at the edge so a bad name is a 400, not the engine's 500.
  if (!isValidIdentifier(input.name) || input.name.length > 50) {
    throw new ValidationError("name must be a lowercase identifier ([a-z_][a-z0-9_]*, max 50)");
  }
  const user = `${input.name}_app`;
  const password = randomBytes(24).toString("hex");
  const adminUrl = openStr(server.adminSecretRef, config);

  const result = await withAdmin(adminUrl, (exec) =>
    provisionDatabase({ database: input.name, user, password }, exec),
  );
  if (!result.ok) {
    throw new AppError(result.error ?? "provisioning failed", {
      status: 400,
      code: "databases.provision_failed",
    });
  }

  const dbId = newId("db");
  const rows = await db
    .insert(databases)
    .values({
      id: dbId,
      serverId: server.id,
      organizationId: orgId,
      name: input.name,
      ownerRole: user,
      appId: input.appId ?? null,
    })
    .returning();
  await db.insert(databaseUsers).values({
    id: newId("dbu"),
    serverId: server.id,
    organizationId: orgId,
    username: user,
    passwordSecretRef: sealStr(password, config),
    databaseId: dbId,
  });

  return {
    database: toDatabaseView(rows[0]!),
    connectionString: buildConnectionString({
      user,
      password,
      host: server.host,
      port: server.port,
      database: input.name,
      ssl: server.tls,
    }),
  };
}

export async function dropDatabase(
  db: Db,
  config: Env,
  orgId: string,
  id: string,
  pool: DbStudioPool = dbStudioPool,
): Promise<void> {
  const rows = await db
    .select()
    .from(databases)
    .where(and(eq(databases.id, id), eq(databases.organizationId, orgId)))
    .limit(1);
  const target = rows[0];
  if (!target) throw new NotFoundError("database not found");
  const server = await serverRow(db, orgId, target.serverId);
  // Close any Database Studio pooled connection to this managed DB first — else
  // DROP DATABASE fails while the pool still pins a session (surfaced on the VM).
  await pool.evict(`managed:${id}`);
  const adminUrl = openStr(server.adminSecretRef, config);
  await withAdmin(adminUrl, async (exec) => {
    for (const stmt of dropStatements({ database: target.name, user: target.ownerRole })) {
      await exec(stmt);
    }
  });
  await db.delete(databases).where(eq(databases.id, id));
}
