import { ConflictError, NotFoundError, ValidationError, newId } from "@ss/shared";
import { and, desc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import type { BuildConfig } from "../db/schema/apps.js";
import { apps, servers, vcsConnections } from "../db/schema/index.js";
import { buildPage, type PageResult } from "../lib/pagination.js";

import { afterCursor, isUniqueViolation } from "./util.js";

// Apps service (04-api-openapi.md). Every query is scoped to the actor's org
// (tenant isolation, 05-auth-rbac.md): a cross-tenant id simply doesn't match,
// so reads/writes/deletes on another org's app return 404 (existence not leaked).

const MB = 1024 * 1024;

export interface AppView {
  id: string;
  organizationId: string;
  name: string;
  repo: string | null;
  image: string | null;
  branch: string;
  port: number;
  cpu: number | null; // CPU cores (e.g. 0.5); maps to cpu_limit
  memoryMb: number | null; // memory limit in MB; maps to mem_limit_bytes
  buildStrategy: "compose" | "dockerfile" | "nixpacks" | "buildpacks" | "static";
  buildConfig: {
    rootDirectory: string | null;
    dockerfilePath: string | null;
    publishDirectory: string | null;
    builder: string | null;
  };
  vcsConnectionId: string | null; // clone credential source (26)
  gitPollEnabled: boolean; // webhookless auto-deploy via the poll cron (R2.1)
  previewEnabled: boolean;
  previewWildcardDomain: string | null;
  previewLimit: number;
  registryCredentialId: string | null;
  preDeployCommand: string | null;
  postDeployCommand: string | null;
  createdAt: string;
}

type AppRow = typeof apps.$inferSelect;

function toView(r: AppRow): AppView {
  return {
    id: r.id,
    organizationId: r.organizationId,
    name: r.name,
    repo: r.repo,
    image: r.image,
    branch: r.branch,
    port: r.port,
    cpu: r.cpuLimit != null ? Number(r.cpuLimit) : null,
    memoryMb: r.memLimitBytes != null ? Math.round(r.memLimitBytes / MB) : null,
    buildStrategy: r.buildStrategy,
    buildConfig: {
      rootDirectory: r.buildConfig?.rootDirectory ?? null,
      dockerfilePath: r.buildConfig?.dockerfilePath ?? null,
      publishDirectory: r.buildConfig?.publishDirectory ?? null,
      builder: r.buildConfig?.builder ?? null,
    },
    vcsConnectionId: r.vcsConnectionId,
    gitPollEnabled: r.gitPollEnabled,
    previewEnabled: r.previewEnabled,
    previewWildcardDomain: r.previewWildcardDomain,
    previewLimit: r.previewLimit,
    registryCredentialId: r.registryCredentialId,
    preDeployCommand: r.preDeployCommand,
    postDeployCommand: r.postDeployCommand,
    createdAt: r.createdAt.toISOString(),
  };
}

// Body references must live in the caller's org.
async function assertServerInOrg(db: Db, orgId: string, serverId: string): Promise<void> {
  const rows = await db
    .select({ id: servers.id })
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new ValidationError("serverId does not reference a server in this org");
}

async function assertConnectionInOrg(db: Db, orgId: string, connectionId: string): Promise<void> {
  const rows = await db
    .select({ id: vcsConnections.id })
    .from(vcsConnections)
    .where(and(eq(vcsConnections.id, connectionId), eq(vcsConnections.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) {
    throw new ValidationError("vcsConnectionId does not reference a connection in this org");
  }
}

export async function listApps(
  db: Db,
  orgId: string,
  opts: { limit: number; cursor?: string },
): Promise<PageResult<AppView>> {
  const keyset = afterCursor(apps.createdAt, apps.id, opts.cursor);
  const where = keyset
    ? and(eq(apps.organizationId, orgId), keyset)
    : eq(apps.organizationId, orgId);
  const rows = await db
    .select()
    .from(apps)
    .where(where)
    .orderBy(desc(apps.createdAt), desc(apps.id))
    .limit(opts.limit + 1);
  const built = buildPage(rows, opts.limit, (r) => r.createdAt.toISOString());
  return { data: built.data.map(toView), page: built.page };
}

type BuildStrategy = "compose" | "dockerfile" | "nixpacks" | "buildpacks" | "static";
export interface BuildConfigInput {
  rootDirectory?: string;
  dockerfilePath?: string;
  publishDirectory?: string;
  builder?: string;
}

/** The jsonb build_config, with its strategy kept in sync with the column. */
function buildConfigFrom(strategy: BuildStrategy, cfg?: BuildConfigInput): BuildConfig {
  return {
    strategy,
    ...(cfg?.rootDirectory ? { rootDirectory: cfg.rootDirectory } : {}),
    ...(cfg?.dockerfilePath ? { dockerfilePath: cfg.dockerfilePath } : {}),
    ...(cfg?.publishDirectory ? { publishDirectory: cfg.publishDirectory } : {}),
    ...(cfg?.builder ? { builder: cfg.builder } : {}),
  };
}

export async function createApp(
  db: Db,
  orgId: string,
  input: {
    name: string;
    repo?: string;
    image?: string;
    branch?: string;
    port?: number;
    cpu?: number;
    memoryMb?: number;
    serverId?: string;
    vcsConnectionId?: string;
    buildStrategy?: BuildStrategy;
    buildConfig?: BuildConfigInput;
  },
): Promise<AppView> {
  if (input.serverId) await assertServerInOrg(db, orgId, input.serverId);
  if (input.vcsConnectionId) await assertConnectionInOrg(db, orgId, input.vcsConnectionId);
  const setsBuild = input.buildStrategy !== undefined || input.buildConfig !== undefined;
  const strategy = input.buildStrategy ?? "compose";
  try {
    const rows = await db
      .insert(apps)
      .values({
        id: newId("app"),
        organizationId: orgId,
        name: input.name,
        repo: input.repo ?? null,
        image: input.image ?? null,
        branch: input.branch ?? "main",
        ...(input.port !== undefined ? { port: input.port } : {}),
        ...(input.cpu !== undefined ? { cpuLimit: String(input.cpu) } : {}),
        ...(input.memoryMb !== undefined ? { memLimitBytes: input.memoryMb * MB } : {}),
        serverId: input.serverId ?? null,
        vcsConnectionId: input.vcsConnectionId ?? null,
        ...(setsBuild
          ? { buildStrategy: strategy, buildConfig: buildConfigFrom(strategy, input.buildConfig) }
          : {}),
      })
      .returning();
    return toView(rows[0]!);
  } catch (err) {
    if (isUniqueViolation(err))
      throw new ConflictError(`an app named "${input.name}" already exists`);
    throw err;
  }
}

export async function getApp(db: Db, orgId: string, id: string): Promise<AppView> {
  const rows = await db
    .select()
    .from(apps)
    .where(and(eq(apps.id, id), eq(apps.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("app not found");
  return toView(rows[0]);
}

export async function updateApp(
  db: Db,
  orgId: string,
  id: string,
  patch: {
    name?: string;
    repo?: string | null;
    image?: string | null;
    branch?: string;
    port?: number;
    cpu?: number | null;
    memoryMb?: number | null;
    serverId?: string | null;
    vcsConnectionId?: string | null;
    buildStrategy?: BuildStrategy;
    buildConfig?: BuildConfigInput;
    gitPollEnabled?: boolean;
    previewEnabled?: boolean;
    previewWildcardDomain?: string | null;
    previewLimit?: number;
    registryCredentialId?: string | null;
    preDeployCommand?: string | null;
    postDeployCommand?: string | null;
  },
): Promise<AppView> {
  if (patch.serverId) await assertServerInOrg(db, orgId, patch.serverId);
  if (patch.vcsConnectionId) await assertConnectionInOrg(db, orgId, patch.vcsConnectionId);
  const set: Partial<typeof apps.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.repo !== undefined) set.repo = patch.repo;
  if (patch.image !== undefined) set.image = patch.image;
  if (patch.branch !== undefined) set.branch = patch.branch;
  if (patch.port !== undefined) set.port = patch.port;
  if (patch.cpu !== undefined) set.cpuLimit = patch.cpu === null ? null : String(patch.cpu);
  if (patch.memoryMb !== undefined)
    set.memLimitBytes = patch.memoryMb === null ? null : patch.memoryMb * MB;
  if (patch.serverId !== undefined) set.serverId = patch.serverId;
  if (patch.vcsConnectionId !== undefined) set.vcsConnectionId = patch.vcsConnectionId;
  if (patch.gitPollEnabled !== undefined) set.gitPollEnabled = patch.gitPollEnabled;
  if (patch.previewEnabled !== undefined) set.previewEnabled = patch.previewEnabled;
  if (patch.previewWildcardDomain !== undefined)
    set.previewWildcardDomain = patch.previewWildcardDomain;
  if (patch.previewLimit !== undefined) set.previewLimit = patch.previewLimit;
  if (patch.registryCredentialId !== undefined)
    set.registryCredentialId = patch.registryCredentialId;
  if (patch.preDeployCommand !== undefined) set.preDeployCommand = patch.preDeployCommand;
  if (patch.postDeployCommand !== undefined) set.postDeployCommand = patch.postDeployCommand;
  // Build strategy + config: merge over the current row so a partial patch
  // (e.g. just publishDirectory) keeps the rest, and the jsonb strategy stays
  // in sync with the column.
  if (patch.buildStrategy !== undefined || patch.buildConfig !== undefined) {
    const current = await getApp(db, orgId, id); // 404s cross-tenant
    const strategy = patch.buildStrategy ?? current.buildStrategy;
    set.buildStrategy = strategy;
    const root = patch.buildConfig?.rootDirectory ?? current.buildConfig.rootDirectory;
    const dockerfilePath = patch.buildConfig?.dockerfilePath ?? current.buildConfig.dockerfilePath;
    const publishDirectory =
      patch.buildConfig?.publishDirectory ?? current.buildConfig.publishDirectory;
    const builder = patch.buildConfig?.builder ?? current.buildConfig.builder;
    set.buildConfig = buildConfigFrom(strategy, {
      ...(root ? { rootDirectory: root } : {}),
      ...(dockerfilePath ? { dockerfilePath } : {}),
      ...(publishDirectory ? { publishDirectory } : {}),
      ...(builder ? { builder } : {}),
    });
  }
  if (Object.keys(set).length === 0) return getApp(db, orgId, id);
  try {
    const rows = await db
      .update(apps)
      .set(set)
      .where(and(eq(apps.id, id), eq(apps.organizationId, orgId)))
      .returning();
    if (!rows[0]) throw new NotFoundError("app not found");
    return toView(rows[0]);
  } catch (err) {
    if (isUniqueViolation(err))
      throw new ConflictError(`an app named "${patch.name}" already exists`);
    throw err;
  }
}

export async function deleteApp(db: Db, orgId: string, id: string): Promise<void> {
  const rows = await db
    .delete(apps)
    .where(and(eq(apps.id, id), eq(apps.organizationId, orgId)))
    .returning({ id: apps.id });
  if (!rows[0]) throw new NotFoundError("app not found");
}
