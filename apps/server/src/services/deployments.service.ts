import { AppError, ConflictError, NotFoundError, newId } from "@ss/shared";
import { and, asc, desc, eq, getTableColumns, gt, inArray, lt } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { apps, deploymentLogs, deploymentSteps, deployments } from "../db/schema/index.js";
import { abortDeploy } from "../deploy/cancel-registry.js";
import type { DeployMeta } from "../deploy/executor.js";
import { isUniqueViolation } from "../lib/db-errors.js";
import { buildPage, type PageResult } from "../lib/pagination.js";
import { logBus } from "../realtime/bus.js";

import { afterCursor } from "./util.js";

export type DeploymentStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type DeploymentTrigger =
  | "push"
  | "manual"
  | "api"
  | "mcp"
  | "schedule"
  | "rollback"
  | "preview";

export interface DeploymentView {
  id: string;
  appId: string;
  organizationId: string;
  status: DeploymentStatus;
  trigger: DeploymentTrigger;
  commitAfter: string | null;
  errorMessage: string | null;
  meta: DeployMeta | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

type DeploymentRow = typeof deployments.$inferSelect;

function toView(r: DeploymentRow): DeploymentView {
  return {
    id: r.id,
    appId: r.appId,
    organizationId: r.organizationId,
    status: r.status,
    trigger: r.trigger,
    commitAfter: r.commitAfter,
    errorMessage: r.errorMessage,
    meta: (r.meta as DeployMeta | null) ?? null,
    queuedAt: r.queuedAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

async function assertApp(db: Db, orgId: string, appId: string): Promise<void> {
  const rows = await db
    .select({ id: apps.id })
    .from(apps)
    .where(and(eq(apps.id, appId), eq(apps.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("app not found");
}

// Per-app serialization: two concurrent pipelines race on containers,
// the image tag, and Caddy converge. Until the pg-boss queue (06) serializes
// work, a new deployment is rejected while one is queued|running for the app —
// checked up front (friendly 409) and enforced by the partial unique index
// `deployments_one_active_per_app` under races.
export const ACTIVE_DEPLOYMENT_STATUSES: readonly DeploymentStatus[] = ["queued", "running"];

export { isUniqueViolation };

export async function createDeployment(
  db: Db,
  orgId: string,
  appId: string,
  opts: { trigger: DeploymentTrigger; triggeredBy?: string },
): Promise<DeploymentView> {
  await assertApp(db, orgId, appId);
  const active = (
    await db
      .select({ id: deployments.id })
      .from(deployments)
      .where(
        and(
          eq(deployments.appId, appId),
          inArray(deployments.status, [...ACTIVE_DEPLOYMENT_STATUSES]),
        ),
      )
      .limit(1)
  )[0];
  if (active) {
    throw new ConflictError("a deployment is already queued or running for this app", {
      activeDeploymentId: active.id,
    });
  }
  try {
    const rows = await db
      .insert(deployments)
      .values({
        id: newId("dpl"),
        appId,
        organizationId: orgId,
        trigger: opts.trigger,
        status: "queued",
        ...(opts.triggeredBy ? { triggeredBy: opts.triggeredBy } : {}),
      })
      .returning();
    return toView(rows[0]!);
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Lost the race to a concurrent create — same outcome as the check above.
      throw new ConflictError("a deployment is already queued or running for this app");
    }
    throw err;
  }
}

/** Roll back to a previous succeeded deployment: create a new (rollback)
 *  deployment that re-runs the target's image. Returns the new deployment + the
 *  image for the executor to run (no rebuild). */
export async function rollbackDeployment(
  db: Db,
  orgId: string,
  deploymentId: string,
): Promise<{ deployment: DeploymentView; image: string }> {
  const target = await getDeployment(db, orgId, deploymentId); // 404 if cross-tenant
  if (target.status !== "succeeded") {
    throw new AppError("can only roll back to a succeeded deployment", {
      status: 400,
      code: "deployment.not_rollbackable",
    });
  }
  const image = target.meta?.image;
  if (!image) {
    throw new AppError("that deployment has no image to roll back to", {
      status: 400,
      code: "deployment.no_image",
    });
  }
  const deployment = await createDeployment(db, orgId, target.appId, { trigger: "rollback" });
  return { deployment, image };
}

export async function listDeployments(
  db: Db,
  orgId: string,
  appId: string,
  opts: { limit: number; cursor?: string },
): Promise<PageResult<DeploymentView>> {
  await assertApp(db, orgId, appId);
  const keyset = afterCursor(deployments.queuedAt, deployments.id, opts.cursor);
  const base = and(eq(deployments.organizationId, orgId), eq(deployments.appId, appId));
  const rows = await db
    .select()
    .from(deployments)
    .where(keyset ? and(base, keyset) : base)
    .orderBy(desc(deployments.queuedAt), desc(deployments.id))
    .limit(opts.limit + 1);
  const built = buildPage(rows, opts.limit, (r) => r.queuedAt.toISOString());
  return { data: built.data.map(toView), page: built.page };
}

export interface OrgDeploymentView extends DeploymentView {
  appName: string;
}

/**
 * Org-wide recent deployments across every app (the mobile Deploys feed) — same
 * `(queuedAt, id)` keyset as the per-app list, joined to the app name so each row is
 * legible without a second lookup. Org-scoped; no per-app gate.
 */
export async function listOrgDeployments(
  db: Db,
  orgId: string,
  opts: { limit: number; cursor?: string },
): Promise<PageResult<OrgDeploymentView>> {
  const keyset = afterCursor(deployments.queuedAt, deployments.id, opts.cursor);
  const base = eq(deployments.organizationId, orgId);
  const rows = await db
    .select({ ...getTableColumns(deployments), appName: apps.name })
    .from(deployments)
    .innerJoin(apps, eq(apps.id, deployments.appId))
    .where(keyset ? and(base, keyset) : base)
    .orderBy(desc(deployments.queuedAt), desc(deployments.id))
    .limit(opts.limit + 1);
  const built = buildPage(rows, opts.limit, (r) => r.queuedAt.toISOString());
  return {
    data: built.data.map((r) => ({ ...toView(r), appName: r.appName })),
    page: built.page,
  };
}

export async function getDeployment(db: Db, orgId: string, id: string): Promise<DeploymentView> {
  const rows = await db
    .select()
    .from(deployments)
    .where(and(eq(deployments.id, id), eq(deployments.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("deployment not found");
  return toView(rows[0]);
}

export interface LogLine {
  seq: number;
  stream: "stdout" | "stderr" | "system";
  line: string;
  at: string;
}

export async function getDeploymentLogs(
  db: Db,
  orgId: string,
  id: string,
  opts: { sinceSeq?: number; beforeSeq?: number; limit?: number } = {},
): Promise<{ lines: LogLine[] }> {
  await getDeployment(db, orgId, id); // 404 if cross-tenant / missing
  const select = db
    .select({
      seq: deploymentLogs.seq,
      stream: deploymentLogs.stream,
      line: deploymentLogs.line,
      at: deploymentLogs.at,
    })
    .from(deploymentLogs);
  // beforeSeq pages BACKWARD through history (newest-first window, returned
  // oldest-first so callers prepend); sinceSeq tails forward as before.
  if (opts.beforeSeq !== undefined) {
    const rows = await select
      .where(and(eq(deploymentLogs.deploymentId, id), lt(deploymentLogs.seq, opts.beforeSeq)))
      .orderBy(desc(deploymentLogs.seq))
      .limit(opts.limit ?? 500);
    return { lines: rows.reverse().map((r) => ({ ...r, at: r.at.toISOString() })) };
  }
  const where = opts.sinceSeq
    ? and(eq(deploymentLogs.deploymentId, id), gt(deploymentLogs.seq, opts.sinceSeq))
    : eq(deploymentLogs.deploymentId, id);
  const rows = await select
    .where(where)
    .orderBy(asc(deploymentLogs.seq))
    .limit(opts.limit ?? 5000);
  return { lines: rows.map((r) => ({ ...r, at: r.at.toISOString() })) };
}

/** Cancel a deployment. QUEUED → atomic queued→cancelled (frees the per-app
 *  active slot; the queue worker's claim guard ignores the dead job). RUNNING
 *  → cooperatively abort the in-process pipeline (SIGKILLs the current child);
 *  the executor finalizes the row as cancelled. A running deploy on another
 *  control-plane instance isn't reachable from here (process-local registry). */
export async function cancelDeployment(db: Db, orgId: string, id: string): Promise<DeploymentView> {
  const existing = await getDeployment(db, orgId, id); // 404 if cross-tenant / missing
  const rows = await db
    .update(deployments)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(deployments.id, id), eq(deployments.status, "queued")))
    .returning();
  if (rows[0]) {
    logBus.publishStatus(id, "cancelled");
    return toView(rows[0]);
  }
  if (existing.status === "running" && abortDeploy(id)) {
    // The executor's catch flips the row to cancelled once the child dies;
    // return the (still-running) view — the client polls for the transition.
    return existing;
  }
  throw new ConflictError(
    existing.status === "running"
      ? "this deployment is running on another instance and can't be cancelled here"
      : `only a queued or running deployment can be cancelled (status: ${existing.status})`,
  );
}

export interface DeploymentStepView {
  id: string;
  ordinal: number;
  name: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export async function listDeploymentSteps(
  db: Db,
  orgId: string,
  id: string,
): Promise<DeploymentStepView[]> {
  await getDeployment(db, orgId, id); // 404 if cross-tenant / missing
  const rows = await db
    .select()
    .from(deploymentSteps)
    .where(eq(deploymentSteps.deploymentId, id))
    .orderBy(asc(deploymentSteps.ordinal));
  return rows.map((r) => ({
    id: r.id,
    ordinal: r.ordinal,
    name: r.name,
    status: r.status,
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
  }));
}
