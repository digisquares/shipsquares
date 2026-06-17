import { AppError, NotFoundError, ValidationError, newId } from "@ss/shared";
import type { Env } from "@ss/shared";
import { and, desc, eq } from "drizzle-orm";
import postgres from "postgres";

import {
  type ReplicaTarget,
  createPublicationSql,
  createSubscriptionSql,
  dropPublicationSql,
  dropSubscriptionSql,
  slotName,
} from "../backups/replication.js";
import type { Db } from "../db/index.js";
import { databaseServers, dbReplicas } from "../db/schema/index.js";
import { loadMasterKey, open } from "../secrets/crypto.js";
import type { SealedValue } from "../secrets/types.js";

// Logical-replication management (ROADMAP R5.1): set up a PUBLICATION on the
// primary managed PG and a SUBSCRIPTION on the replica, both run over the 24
// admin connections via one-shot psql connections. The pure SQL composition
// is in backups/replication.ts; this binds the DB rows + admin conns + status.
// Streaming (base-backup) replication is operator-driven for now — rejected
// with a clear message so the API never half-configures it.

function masterKey(config: Env): Buffer {
  try {
    return loadMasterKey(config.SHIPSQUARES_MASTER_KEY);
  } catch {
    throw new AppError("replication requires SHIPSQUARES_MASTER_KEY", {
      status: 400,
      code: "secrets.unconfigured",
    });
  }
}
const openStr = (s: string, config: Env): string =>
  open(JSON.parse(s) as SealedValue, masterKey(config));

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

/** A server's admin URL parsed into the reachable conninfo a replica uses to
 *  reach the PRIMARY — host/port from the server row (the address other hosts
 *  can route to), credentials + db from the sealed admin URL. */
function primaryTarget(server: typeof databaseServers.$inferSelect, config: Env): ReplicaTarget {
  const url = new URL(openStr(server.adminSecretRef, config));
  return {
    host: server.host,
    port: server.port,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, "") || "postgres",
  };
}

type ReplicaRow = typeof dbReplicas.$inferSelect;

export interface ReplicaView {
  id: string;
  primaryServerId: string;
  replicaServerId: string | null;
  mode: string;
  status: string;
  slotName: string | null;
  createdAt: string;
}

function toView(r: ReplicaRow): ReplicaView {
  return {
    id: r.id,
    primaryServerId: r.primaryServerId,
    replicaServerId: r.replicaServerId,
    mode: r.mode,
    status: r.status,
    slotName: r.slotName,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listReplicas(db: Db, orgId: string): Promise<ReplicaView[]> {
  const rows = await db
    .select()
    .from(dbReplicas)
    .where(eq(dbReplicas.organizationId, orgId))
    .orderBy(desc(dbReplicas.createdAt));
  return rows.map(toView);
}

async function serverInOrg(db: Db, orgId: string, id: string) {
  const row = (
    await db
      .select()
      .from(databaseServers)
      .where(and(eq(databaseServers.id, id), eq(databaseServers.organizationId, orgId)))
      .limit(1)
  )[0];
  if (!row) throw new ValidationError("server does not reference a database server in this org");
  return row;
}

export async function createReplica(
  db: Db,
  config: Env,
  orgId: string,
  input: { primaryServerId: string; replicaServerId: string; mode?: "streaming" | "logical" },
): Promise<ReplicaView> {
  const mode = input.mode ?? "logical";
  if (mode !== "logical") {
    throw new ValidationError(
      "only logical replication is automated today; streaming (base-backup) is operator-driven",
    );
  }
  if (input.primaryServerId === input.replicaServerId) {
    throw new ValidationError("primary and replica must be different servers");
  }
  const primary = await serverInOrg(db, orgId, input.primaryServerId);
  const replica = await serverInOrg(db, orgId, input.replicaServerId);
  if (primary.engine !== "postgres" || replica.engine !== "postgres") {
    throw new ValidationError("logical replication is postgres-only");
  }

  const id = newId("rpl");
  const primaryConn = primaryTarget(primary, config);

  try {
    // Publication on the primary, subscription on the replica.
    await withAdmin(openStr(primary.adminSecretRef, config), (exec) =>
      exec(createPublicationSql(id)),
    );
    await withAdmin(openStr(replica.adminSecretRef, config), (exec) =>
      exec(createSubscriptionSql(id, primaryConn)),
    );
  } catch (err) {
    throw new AppError(
      `replication setup failed: ${err instanceof Error ? err.message : String(err)}`,
      {
        status: 400,
        code: "replication.setup_failed",
      },
    );
  }

  const rows = await db
    .insert(dbReplicas)
    .values({
      id,
      organizationId: orgId,
      primaryServerId: primary.id,
      replicaServerId: replica.id,
      mode: "logical",
      status: "streaming",
      slotName: slotName(id),
    })
    .returning();
  return toView(rows[0]!);
}

export async function deleteReplica(db: Db, config: Env, orgId: string, id: string): Promise<void> {
  const replica = (
    await db
      .select()
      .from(dbReplicas)
      .where(and(eq(dbReplicas.id, id), eq(dbReplicas.organizationId, orgId)))
      .limit(1)
  )[0];
  if (!replica) throw new NotFoundError("replica not found");

  // Best-effort teardown: drop the subscription on the replica, the
  // publication on the primary. A torn-down row leaves no orphan objects.
  const primary = (
    await db
      .select()
      .from(databaseServers)
      .where(eq(databaseServers.id, replica.primaryServerId))
      .limit(1)
  )[0];
  const replicaServer = replica.replicaServerId
    ? (
        await db
          .select()
          .from(databaseServers)
          .where(eq(databaseServers.id, replica.replicaServerId))
          .limit(1)
      )[0]
    : undefined;
  if (replicaServer) {
    await withAdmin(openStr(replicaServer.adminSecretRef, config), (exec) =>
      exec(dropSubscriptionSql(id)),
    ).catch(() => undefined);
  }
  if (primary) {
    await withAdmin(openStr(primary.adminSecretRef, config), (exec) =>
      exec(dropPublicationSql(id)),
    ).catch(() => undefined);
  }
  await db.delete(dbReplicas).where(eq(dbReplicas.id, id));
}
