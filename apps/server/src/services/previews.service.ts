import { newId } from "@ss/shared";
import type { Env } from "@ss/shared";
import { and, desc, eq, ne } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { previewEnvironments } from "../db/schema/index.js";
import { previewFqdn, previewLimitReached } from "../previews/fqdn.js";
import { teardownPreview } from "../previews/orchestrator.js";
import { parsePullRequestEvent, previewActionFor } from "../previews/pr-events.js";

// Preview-environment state over PR webhooks (31-preview-environments.md): the
// tested pr-events core decides; this records the lifecycle rows (one per
// app+PR, unique-indexed). The deploy/teardown ORCHESTRATOR (building the
// preview container, routing the wildcard domain, PR comments) is the recorded
// remainder — rows land as "building" until it exists.

interface PreviewApp {
  id: string;
  name: string;
  organizationId: string;
  previewEnabled: boolean;
  previewWildcardDomain: string | null;
  previewLimit: number;
}

export interface PreviewView {
  id: string;
  prNumber: number;
  prTitle: string | null;
  branch: string;
  status: string;
  domain: string | null;
  createdAt: string;
  closedAt: string | null;
}

export async function listPreviews(db: Db, appId: string): Promise<PreviewView[]> {
  const rows = await db
    .select()
    .from(previewEnvironments)
    .where(eq(previewEnvironments.appId, appId))
    .orderBy(desc(previewEnvironments.createdAt));
  return rows.map((r) => ({
    id: r.id,
    prNumber: r.prNumber,
    prTitle: r.prTitle,
    branch: r.branch,
    status: r.status,
    domain: r.domain,
    createdAt: r.createdAt.toISOString(),
    closedAt: r.closedAt?.toISOString() ?? null,
  }));
}

async function activeCount(db: Db, appId: string): Promise<number> {
  const rows = await db
    .select({ id: previewEnvironments.id })
    .from(previewEnvironments)
    .where(and(eq(previewEnvironments.appId, appId), ne(previewEnvironments.status, "closed")));
  return rows.length;
}

export interface PrIngestResult {
  status: number;
  body: Record<string, unknown>;
}

/** Route a pull_request webhook for an app: decide via the tested core, record
 *  the preview row transition, acknowledge. Never deploys here — the
 *  orchestrator picks rows up (pending). */
export interface QueueLike {
  send(name: string, data: object): Promise<unknown>;
}

export async function handlePullRequest(
  db: Db,
  config: Env,
  queue: QueueLike | null,
  app: PreviewApp,
  payload: unknown,
): Promise<PrIngestResult> {
  const event = parsePullRequestEvent(payload);
  if (!event) return { status: 400, body: { code: "webhook.bad_payload" } };

  const decision = previewActionFor(event, {
    enabled: app.previewEnabled,
    requireLabel: null,
    trustedOnly: true,
    limitReached: previewLimitReached(await activeCount(db, app.id), app.previewLimit),
  });

  if (decision.action === "ignore") {
    return { status: 200, body: { ignored: true, reason: decision.reason } };
  }

  if (decision.action === "teardown") {
    await db
      .update(previewEnvironments)
      .set({ status: "closed", closedAt: new Date() })
      .where(
        and(
          eq(previewEnvironments.appId, app.id),
          eq(previewEnvironments.prNumber, event.prNumber),
        ),
      );
    // Runtime half (container + route) is async — the webhook ack stays fast.
    void teardownPreview(db, config, app.id, event.prNumber);
    return { status: 202, body: { preview: "teardown", pr: event.prNumber } };
  }

  // deploy: upsert the row (unique on app+pr); the orchestrator builds it.
  const domain = app.previewWildcardDomain
    ? previewFqdn(event.prNumber, app.name, app.previewWildcardDomain)
    : null;
  const existing = await db
    .update(previewEnvironments)
    .set({ status: "building", branch: event.headRef, prTitle: event.title, closedAt: null })
    .where(
      and(eq(previewEnvironments.appId, app.id), eq(previewEnvironments.prNumber, event.prNumber)),
    )
    .returning({ id: previewEnvironments.id });
  if (!existing[0]) {
    await db.insert(previewEnvironments).values({
      id: newId("prev"),
      appId: app.id,
      prNumber: event.prNumber,
      prTitle: event.title,
      branch: event.headRef,
      status: "building",
      domain,
    });
  }
  // Deploy the PR head: a real deployment row (trigger "preview") through the
  // queue — the executor stamps the row and converge routes the FQDN.
  try {
    const { createDeployment } = await import("./deployments.service.js");
    const dep = await createDeployment(db, app.organizationId, app.id, { trigger: "preview" });
    const previewCtx = { prNumber: event.prNumber, branch: event.headRef };
    const { dispatchDeploy } = await import("../deploy/dispatch.js");
    const inline = () => {
      void import("../deploy/executor.js")
        .then((m) => m.executeDeploy(db, dep.id, { preview: previewCtx }))
        .catch(() => undefined);
    };
    if (queue) await dispatchDeploy(queue, dep.id, { preview: previewCtx }, inline);
    else inline();
    return {
      status: 202,
      body: { preview: "deploy", pr: event.prNumber, domain, deploymentId: dep.id },
    };
  } catch {
    // one-active-per-app: the next synchronize event retries the preview
    return {
      status: 202,
      body: { preview: "deploy", pr: event.prNumber, domain, note: "waiting on active deployment" },
    };
  }
}
