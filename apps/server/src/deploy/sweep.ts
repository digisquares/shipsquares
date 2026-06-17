import { inArray } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { deployments } from "../db/schema/index.js";

// Boot recovery: a control-plane restart strands RUNNING rows — their owning
// pipeline died with the process, nothing finishes them, and they block new
// deploys under the one-active-per-app rule. QUEUED rows are left alone now:
// they live on the pg-boss "deploy" queue and are redelivered after restart.
// Called once at startup; complements migration 0003's one-time cleanup.
export async function sweepStaleDeployments(db: Db): Promise<number> {
  const rows = await db
    .update(deployments)
    .set({
      status: "failed",
      errorMessage: "control plane restarted mid-deploy",
      finishedAt: new Date(),
    })
    .where(inArray(deployments.status, ["running"]))
    .returning({ id: deployments.id });
  return rows.length;
}
