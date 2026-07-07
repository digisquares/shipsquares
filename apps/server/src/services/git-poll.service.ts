import { ConflictError } from "@ss/shared";
import type { Env } from "@ss/shared";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import type PgBoss from "pg-boss";

import type { Db } from "../db/index.js";
import { apps, deployments } from "../db/schema/index.js";
import { DEPLOY_QUEUE, dispatchDeploy } from "../deploy/dispatch.js";
import { runCommand } from "../deploy/exec.js";
import { swallow } from "../lib/swallow.js";
import { cloneUrlFor } from "../vcs/resolve-clone.js";
import { parseLsRemoteHead, pollDecision } from "../webhooks/poll.js";

import { createDeployment } from "./deployments.service.js";

// Git-poll fallback (ROADMAP R2.1): a single pg-boss cron sweeps every app
// with gitPollEnabled, compares `git ls-remote` against the last deployed
// commit, and triggers a deploy on drift — the no-webhook path for boxes
// behind NAT/firewalls (Portainer's change-detected polling model).
// Best-effort per app: one unreachable remote never blocks the sweep.

export const GIT_POLL_QUEUE = "git-poll";
const POLL_CRON = "*/2 * * * *";
const LS_REMOTE_TIMEOUT_MS = 30_000;

export async function pollOnce(
  db: Db,
  queue: PgBoss,
): Promise<{ checked: number; triggered: number }> {
  const candidates = await db
    .select()
    .from(apps)
    .where(and(eq(apps.gitPollEnabled, true), isNotNull(apps.repo)));
  let triggered = 0;

  for (const app of candidates) {
    try {
      const cloneUrl = await cloneUrlFor(db, app);
      const out = await runCommand(
        "git",
        ["ls-remote", cloneUrl, `refs/heads/${app.branch}`, "HEAD"],
        { timeoutMs: LS_REMOTE_TIMEOUT_MS },
      );
      if (out.code !== 0) continue;
      const remoteHead = parseLsRemoteHead(
        out.lines
          .filter((l) => l.stream === "stdout")
          .map((l) => l.line)
          .join("\n"),
        app.branch,
      );
      const last = (
        await db
          .select({ commitAfter: deployments.commitAfter })
          .from(deployments)
          .where(
            and(
              eq(deployments.appId, app.id),
              eq(deployments.status, "succeeded"),
              ne(deployments.trigger, "preview"),
            ),
          )
          .orderBy(desc(deployments.finishedAt))
          .limit(1)
      )[0];
      if (
        pollDecision({ remoteHead, lastDeployedCommit: last?.commitAfter ?? null }) !== "deploy"
      ) {
        continue;
      }

      try {
        const dep = await createDeployment(db, app.organizationId, app.id, { trigger: "push" });
        triggered += 1;
        await dispatchDeploy(queue, dep.id, {}, () => {
          // Fire-and-forget fallback (runs when queue.send failed): executeDeploy's
          // initial DB reads are before its own try/catch, so an early reject here
          // would be an unhandled rejection → process exit. Swallow like siblings.
          void import("../deploy/executor.js")
            .then((m) => m.executeDeploy(db, dep.id))
            .catch((e) => swallow("git-poll.inline_deploy", e));
        });
      } catch (err) {
        // An active deploy already covers this drift — poll again next tick.
        if (!(err instanceof ConflictError)) throw err;
      }
    } catch {
      // best-effort per app
    }
  }
  return { checked: candidates.length, triggered };
}

/** Register the poll cron + worker (idempotent; non-fatal without the queue). */
export async function bootGitPoll(db: Db, _config: Env, boss: PgBoss): Promise<void> {
  await boss.createQueue(GIT_POLL_QUEUE);
  await boss.unschedule(GIT_POLL_QUEUE).catch(() => undefined);
  await boss.schedule(GIT_POLL_QUEUE, POLL_CRON, {}, { tz: "UTC" });
  await boss.work(GIT_POLL_QUEUE, async () => {
    await pollOnce(db, boss);
  });
}

// DEPLOY_QUEUE re-export keeps the dispatch import in one place for callers.
export { DEPLOY_QUEUE };
