import { AppError, ConflictError, NotFoundError, ValidationError, newId } from "@ss/shared";
import type { Env } from "@ss/shared";
import { and, desc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { servers } from "../db/schema/index.js";
import { buildPage, type PageResult } from "../lib/pagination.js";
import { swallow } from "../lib/swallow.js";
import { loadMasterKey, open, seal } from "../secrets/crypto.js";
import type { SealedValue } from "../secrets/types.js";
import { bootstrapSucceeded, runBootstrap } from "../servers/bootstrap.js";
import { canTransition, type ServerStatus } from "../servers/model.js";
import { buildBootstrapSteps } from "../servers/steps.js";
import { generateSshKeyPair } from "../ssh/keys.js";
import { sshPool } from "../ssh/pool.js";

import { afterCursor } from "./util.js";

// Servers service (04-api-openapi.md / 09-multi-server.md). Org-scoped like
// apps. Each server gets a platform-generated SSH keypair at create: the
// private key is sealed into the secret store (sshRef), the public key is
// returned ONCE for the operator to install in authorized_keys. Bootstrap
// runs the tested step orchestrator over the pooled SSH executor.

const KEY_VERSION = 1;

function masterKey(config: Env): Buffer {
  try {
    return loadMasterKey(config.SHIPSQUARES_MASTER_KEY);
  } catch {
    throw new AppError("server SSH keys require SHIPSQUARES_MASTER_KEY", {
      status: 400,
      code: "secrets.unconfigured",
    });
  }
}
const sealStr = (plain: string, config: Env): string =>
  JSON.stringify(seal(plain, masterKey(config), KEY_VERSION));
const openStr = (s: string, config: Env): string =>
  open(JSON.parse(s) as SealedValue, masterKey(config));

export interface ServerView {
  id: string;
  organizationId: string;
  name: string;
  host: string;
  sshPort: number;
  role: "control" | "worker";
  status: ServerStatus;
  dockerOk: boolean;
  caddyOk: boolean;
  createdAt: string;
}

type ServerRow = typeof servers.$inferSelect;

function toView(r: ServerRow): ServerView {
  return {
    id: r.id,
    organizationId: r.organizationId,
    name: r.name,
    host: r.host,
    sshPort: r.sshPort,
    role: r.role,
    status: r.status,
    dockerOk: r.dockerOk,
    caddyOk: r.caddyOk,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listServers(
  db: Db,
  orgId: string,
  opts: { limit: number; cursor?: string },
): Promise<PageResult<ServerView>> {
  const keyset = afterCursor(servers.createdAt, servers.id, opts.cursor);
  const where = keyset
    ? and(eq(servers.organizationId, orgId), keyset)
    : eq(servers.organizationId, orgId);
  const rows = await db
    .select()
    .from(servers)
    .where(where)
    .orderBy(desc(servers.createdAt), desc(servers.id))
    .limit(opts.limit + 1);
  const built = buildPage(rows, opts.limit, (r) => r.createdAt.toISOString());
  return { data: built.data.map(toView), page: built.page };
}

export async function createServer(
  db: Db,
  config: Env,
  orgId: string,
  input: { name: string; host: string; sshPort?: number; sshUser?: string },
): Promise<ServerView & { publicKey: string }> {
  const pair = generateSshKeyPair();
  const rows = await db
    .insert(servers)
    .values({
      id: newId("srv"),
      organizationId: orgId,
      name: input.name,
      host: input.host,
      sshPort: input.sshPort ?? 22,
      sshUser: input.sshUser ?? "root",
      sshRef: sealStr(pair.privateKey, config),
      role: "worker",
    })
    .returning();
  // The public key is shown exactly once — install it in the VM's
  // ~/.ssh/authorized_keys, then POST /servers/:id/bootstrap.
  return { ...toView(rows[0]!), publicKey: pair.publicKey };
}

/** (Re)generate the server's SSH keypair — replaces the sealed private key and
 *  returns the new public key for authorized_keys. */
export async function provisionServerKey(
  db: Db,
  config: Env,
  orgId: string,
  id: string,
): Promise<{ publicKey: string }> {
  await getServerRow(db, orgId, id); // 404 if cross-tenant
  const pair = generateSshKeyPair();
  await db
    .update(servers)
    .set({ sshRef: sealStr(pair.privateKey, config) })
    .where(and(eq(servers.id, id), eq(servers.organizationId, orgId)));
  return { publicKey: pair.publicKey };
}

export async function getServer(db: Db, orgId: string, id: string): Promise<ServerView> {
  const rows = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, id), eq(servers.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("server not found");
  return toView(rows[0]);
}

export async function updateServer(
  db: Db,
  orgId: string,
  id: string,
  patch: { name?: string; sshPort?: number; sshUser?: string },
): Promise<ServerView> {
  const set: Partial<typeof servers.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.sshPort !== undefined) set.sshPort = patch.sshPort;
  if (patch.sshUser !== undefined) set.sshUser = patch.sshUser;
  if (Object.keys(set).length === 0) return getServer(db, orgId, id);
  const rows = await db
    .update(servers)
    .set(set)
    .where(and(eq(servers.id, id), eq(servers.organizationId, orgId)))
    .returning();
  if (!rows[0]) throw new NotFoundError("server not found");
  return toView(rows[0]);
}

export async function deleteServer(db: Db, orgId: string, id: string): Promise<void> {
  const rows = await db
    .delete(servers)
    .where(and(eq(servers.id, id), eq(servers.organizationId, orgId)))
    .returning({ id: servers.id });
  if (!rows[0]) throw new NotFoundError("server not found");
}

async function getServerRow(db: Db, orgId: string, id: string): Promise<ServerRow> {
  const rows = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, id), eq(servers.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("server not found");
  return rows[0];
}

/** Validate + flip the FSM to `bootstrapping`; the actual run is async
 *  (runServerBootstrap) — callers poll GET /servers/:id for ready|error. */
export async function startServerBootstrap(db: Db, orgId: string, id: string): Promise<ServerRow> {
  const row = await getServerRow(db, orgId, id);
  if (!row.sshRef) {
    throw new ValidationError(
      "server has no SSH key — POST /servers/:id/key and install the public key first",
    );
  }
  if (!canTransition(row.status, "bootstrapping")) {
    throw new ConflictError(`server is ${row.status} — bootstrap already in progress`);
  }
  await db
    .update(servers)
    .set({ status: "bootstrapping" })
    .where(and(eq(servers.id, id), eq(servers.organizationId, orgId)));
  return row;
}

/** Run the agentless bootstrap over the pooled SSH executor and persist the
 *  outcome. Never throws — failures land in the row (status: error). */
export async function runServerBootstrap(db: Db, config: Env, row: ServerRow): Promise<void> {
  try {
    const privateKey = openStr(row.sshRef!, config);
    const target = {
      host: row.host,
      port: row.sshPort,
      username: row.sshUser,
      privateKey,
    };
    const results = await runBootstrap(
      buildBootstrapSteps((command, opts) => sshPool.exec(target, command, opts)),
      () => undefined, // step output is not persisted yet (no bootstrap-log store)
    );
    const ok = bootstrapSucceeded(results);
    // Bootstrap added the SSH user to the docker group; drop the (pre-group)
    // pooled connection so the first deploy reconnects in a fresh login session
    // that can reach the docker socket without sudo (R4.1).
    if (ok) sshPool.evict(target);
    await db
      .update(servers)
      .set({
        status: ok ? "ready" : "error",
        dockerOk: ok,
        lastCheckedAt: new Date(),
      })
      .where(eq(servers.id, row.id));
  } catch {
    await db
      .update(servers)
      .set({ status: "error", lastCheckedAt: new Date() })
      .where(eq(servers.id, row.id))
      .catch((e) => swallow("server.mark_error", e));
  }
}

export interface ServerCheckResult {
  dockerOk: boolean;
  dockerVersion: string | null;
  caddyOk: boolean;
  diskUsedPct: number | null;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  reachable: boolean;
  lastCheckedAt: string;
}

/**
 * Connectivity check (R4.4). Probes the server over SSH to check docker + disk,
 * updating the stored flags. For the control server (role=control), returns
 * local status without SSH.
 */
export async function checkServer(
  db: Db,
  config: Env,
  orgId: string,
  id: string,
): Promise<ServerCheckResult> {
  const row = await getServerRow(db, orgId, id); // 404s if cross-tenant
  const now = new Date();

  // Control server: no SSH needed, check local docker
  if (row.role === "control") {
    await db.update(servers).set({ lastCheckedAt: now }).where(eq(servers.id, id));
    return {
      dockerOk: row.dockerOk,
      dockerVersion: null,
      caddyOk: row.caddyOk,
      diskUsedPct: null,
      diskUsedBytes: null,
      diskTotalBytes: null,
      reachable: true,
      lastCheckedAt: now.toISOString(),
    };
  }

  // Worker server: probe over SSH
  if (!row.sshRef) {
    return {
      dockerOk: false,
      dockerVersion: null,
      caddyOk: false,
      diskUsedPct: null,
      diskUsedBytes: null,
      diskTotalBytes: null,
      reachable: false,
      lastCheckedAt: now.toISOString(),
    };
  }

  const { parseDockerVersion, parseDiskUsage } = await import("../servers/health-probe.js");

  try {
    const privateKey = openStr(row.sshRef, config);
    const target = { host: row.host, port: row.sshPort, username: row.sshUser, privateKey };

    // Probe docker version
    const dockerResult = await sshPool.exec(
      target,
      "docker version --format '{{.Server.Version}}'",
      { timeoutMs: 10_000 },
    );
    const dockerOutput = dockerResult.lines
      .filter((l) => l.stream === "stdout")
      .map((l) => l.line)
      .join("\n");
    const docker = parseDockerVersion(dockerOutput, dockerResult.code);

    // Probe disk
    const diskResult = await sshPool.exec(target, "df -kP /", { timeoutMs: 10_000 });
    const diskOutput = diskResult.lines
      .filter((l) => l.stream === "stdout")
      .map((l) => l.line)
      .join("\n");
    const disk = parseDiskUsage(diskOutput, diskResult.code);

    // Update DB
    await db
      .update(servers)
      .set({ dockerOk: docker.ok, lastCheckedAt: now })
      .where(eq(servers.id, id));

    return {
      dockerOk: docker.ok,
      dockerVersion: docker.version ?? null,
      caddyOk: row.caddyOk, // TODO: Caddy probe
      diskUsedPct: disk.usedPct ?? null,
      diskUsedBytes: disk.usedBytes ?? null,
      diskTotalBytes: disk.totalBytes ?? null,
      reachable: true,
      lastCheckedAt: now.toISOString(),
    };
  } catch {
    // SSH failed
    await db.update(servers).set({ lastCheckedAt: now }).where(eq(servers.id, id));
    return {
      dockerOk: false,
      dockerVersion: null,
      caddyOk: false,
      diskUsedPct: null,
      diskUsedBytes: null,
      diskTotalBytes: null,
      reachable: false,
      lastCheckedAt: now.toISOString(),
    };
  }
}
