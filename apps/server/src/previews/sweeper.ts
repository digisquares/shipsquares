import type { Env } from "@ss/shared";
import { eq, ne } from "drizzle-orm";
import type PgBoss from "pg-boss";

import type { Db } from "../db/index.js";
import { previewEnvironments } from "../db/schema/index.js";

import { teardownPreview } from "./orchestrator.js";

// Preview sweeper (31-preview-environments.md): previews are ephemeral by
// contract — a build stuck past its budget (the deploy pipeline died) or a
// running preview past the max age (the PR went quiet without closing) is
// torn down and closed. Rides pg-boss cron hourly; the selection is pure.

const BUILD_BUDGET_MS = 2 * 3_600_000; // a build that old is stranded, not slow
const MAX_AGE_MS = 7 * 24 * 3_600_000;

interface SweepRow {
  id: string;
  status: string;
  createdAt: Date;
}

export function previewsToSweep<T extends SweepRow>(rows: T[], now: Date): T[] {
  return rows.filter((r) => {
    const age = now.getTime() - r.createdAt.getTime();
    if (r.status === "building" || r.status === "failed") return age > BUILD_BUDGET_MS;
    if (r.status === "running") return age > MAX_AGE_MS;
    return false;
  });
}

/** PR comment bodies (posted best-effort by the comment hook when a GitHub
 *  connection exists). Failure bodies never fabricate a URL. */
export function previewCommentBody(input: {
  kind: "deployed" | "closed" | "failed";
  domain?: string | null;
}): string {
  if (input.kind === "deployed") {
    return input.domain
      ? `🚀 Preview deployed: https://${input.domain}`
      : "🚀 Preview deployed (no domain configured — set previewWildcardDomain to get URLs).";
  }
  if (input.kind === "closed") return "🧹 Preview environment torn down.";
  return "❌ Preview deploy failed — check the deployment logs.";
}

export async function sweepPreviews(db: Db, config: Env): Promise<number> {
  const rows = await db
    .select()
    .from(previewEnvironments)
    .where(ne(previewEnvironments.status, "closed"));
  const stale = previewsToSweep(rows, new Date());
  for (const r of stale) {
    await teardownPreview(db, config, r.appId, r.prNumber);
    await db
      .update(previewEnvironments)
      .set({ status: "closed", closedAt: new Date() })
      .where(eq(previewEnvironments.id, r.id));
  }
  return stale.length;
}

export const PREVIEW_SWEEP_QUEUE = "preview:sweep";

export async function bootPreviewSweeper(db: Db, config: Env, boss: PgBoss): Promise<void> {
  await boss.unschedule(PREVIEW_SWEEP_QUEUE).catch(() => undefined);
  // pg-boss v10: schedule/work throw on a queue that was never created.
  await boss.createQueue(PREVIEW_SWEEP_QUEUE);
  await boss.schedule(PREVIEW_SWEEP_QUEUE, "17 * * * *", {}, { tz: "UTC" });
  await boss.work(PREVIEW_SWEEP_QUEUE, async () => {
    await sweepPreviews(db, config);
  });
}
