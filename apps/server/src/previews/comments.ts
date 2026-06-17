import type { Env } from "@ss/shared";
import { eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { apps } from "../db/schema/index.js";
import { buildProviderDeps } from "../vcs/provider-deps.js";
import { createGithubAppProvider } from "../vcs/providers/github-app.js";
import { safeRepoRefFromUrl } from "../vcs/repo-ref.js";

import { previewCommentBody } from "./sweeper.js";

// PR comments for preview lifecycle (31-preview-environments.md): posted with
// the GitHub App installation token of the app's connection. Strictly
// best-effort — a missing connection, non-GitHub provider, or API hiccup
// never affects the deploy/teardown that triggered it.

export function prCommentRequest(
  repoFullName: string,
  prNumber: number,
  body: string,
  token: string,
): { url: string; init: { method: "POST"; headers: Record<string, string>; body: string } } {
  return {
    url: `https://api.github.com/repos/${repoFullName}/issues/${prNumber}/comments`,
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "shipsquares",
      },
      body: JSON.stringify({ body }),
    },
  };
}

export async function postPreviewComment(
  db: Db,
  config: Env,
  appId: string,
  prNumber: number,
  kind: "deployed" | "closed" | "failed",
  domain?: string | null,
): Promise<void> {
  try {
    const app = (await db.select().from(apps).where(eq(apps.id, appId)).limit(1))[0];
    if (!app?.repo || !app.vcsConnectionId) return;
    const repo = safeRepoRefFromUrl(app.repo, app.branch);
    if (!repo) return;
    const { getConnection } = await import("../services/connections.service.js");
    const conn = await getConnection(db, app.organizationId, app.vcsConnectionId);
    if (conn.kind !== "github_app") return; // comments need an installation token
    const provider = createGithubAppProvider(buildProviderDeps(config, db));
    const token = await provider.installationToken(conn);
    const { url, init } = prCommentRequest(
      repo.fullName,
      prNumber,
      previewCommentBody({ kind, ...(domain !== undefined ? { domain } : {}) }),
      token,
    );
    await fetch(url, init);
  } catch {
    /* best-effort by contract */
  }
}
