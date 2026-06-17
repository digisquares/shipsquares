import type { Env } from "@ss/shared";
import { and, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { previewEnvironments } from "../db/schema/index.js";
import { runCommand } from "../deploy/exec.js";
import type { DesiredApp, DesiredDomain } from "../proxy/types.js";

// Preview orchestration (31-preview-environments.md), phase 1: previews are
// first-class in PROXY ROUTING (a running preview row with a domain + port
// routes exactly like an app domain) and teardown actually tears down — the
// container is removed and the route converges away. The preview DEPLOY path
// (clone PR head → build → run on the preview port) is the recorded remainder;
// once it stamps deploymentId/hostPort on the row, routes appear with no
// further wiring.

export function previewContainerName(appId: string, prNumber: number): string {
  return `ss-preview-${appId}-${prNumber}`;
}

export interface PreviewRouteEntry {
  appId: string;
  domain: string | null;
  /** loopback port of the running preview container, when deployed */
  hostPort?: string;
}

/** Pure: running preview rows → Caddy desired routes. No HSTS — preview hosts
 *  are ephemeral and must not pin browser policy past their lifetime. */
export function previewRoutes(entries: PreviewRouteEntry[]): {
  apps: DesiredApp[];
  domains: DesiredDomain[];
} {
  const apps: DesiredApp[] = [];
  const domains: DesiredDomain[] = [];
  for (const e of entries) {
    if (!e.domain || !e.hostPort) continue;
    apps.push({
      appId: e.appId,
      hosts: [e.domain],
      target: { upstream: `127.0.0.1:${e.hostPort}` },
      hsts: false,
      forceHttps: true,
    });
    domains.push({ fqdn: e.domain, managed: "auto" });
  }
  return { apps, domains };
}

/** Remove the preview container and converge the route away. Row state is the
 *  caller's (webhook) concern; this is the runtime half. Never throws. */
export async function teardownPreview(
  db: Db,
  config: Env,
  appId: string,
  prNumber: number,
): Promise<void> {
  try {
    await runCommand("docker", ["rm", "-f", previewContainerName(appId, prNumber)], {
      timeoutMs: 60_000,
    });
    await db
      .update(previewEnvironments)
      .set({ deploymentId: null })
      .where(and(eq(previewEnvironments.appId, appId), eq(previewEnvironments.prNumber, prNumber)));
    const { convergeProxy } = await import("../proxy/caddy/converge.js");
    await convergeProxy(db, config);
    const { postPreviewComment } = await import("./comments.js");
    void postPreviewComment(db, config, appId, prNumber, "closed");
  } catch {
    /* teardown is best-effort — the sweeper will retry */
  }
}
