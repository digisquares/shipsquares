import { loadConfig } from "@ss/shared";

import type { Db } from "../db/index.js";
import { getConnection } from "../services/connections.service.js";

import { buildProviderDeps } from "./provider-deps.js";
import { providerFor } from "./providers/index.js";
import { safeRepoRefFromUrl } from "./repo-ref.js";

// The 06.fetch ↔ 26 handoff: the clone URL the deploy engine should `git clone`.
// When the app is bound to a VCS connection, returns a token-injected HTTPS URL
// (minted fresh for the clone); otherwise the plain repo URL. The token appears
// only in the returned URL — it must never be logged (19-security; the log
// pipeline redacts secrets). SSH deploy-key clones fall back to the plain URL
// for now (a separate GIT_SSH_COMMAND path is the runtime follow-up).
export interface CloneApp {
  repo: string | null;
  branch: string;
  organizationId: string;
  vcsConnectionId: string | null;
}

export async function cloneUrlFor(db: Db, app: CloneApp): Promise<string> {
  if (!app.repo) return "";
  if (!app.vcsConnectionId) return app.repo;
  // scp-style ssh remotes can't carry an https token — clone with the plain
  // URL (deploy keys/agent) instead of failing the deploy on URL parsing.
  const repo = safeRepoRefFromUrl(app.repo, app.branch);
  if (!repo) return app.repo;
  const conn = await getConnection(db, app.organizationId, app.vcsConnectionId);
  const cred = await providerFor(conn.kind, buildProviderDeps(loadConfig(), db)).getCloneCredential(
    conn,
    repo,
  );
  return cred.scheme === "https-token" && cred.url ? cred.url : app.repo;
}
