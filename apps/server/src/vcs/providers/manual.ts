import { buildCloneCredential } from "../clone-credential.js";
import { httpsToSsh, looksLikeSshKey } from "../git-url.js";
import {
  type CloneCredential,
  type RegisteredWebhook,
  type RepoRef,
  type VcsConnection,
  type VcsProvider,
} from "../types.js";

// Manual provider (26-vcs-connections.md): the any-host fallback. No provider
// API — the user pastes a deploy key or PAT, and we show the ingest URL+secret
// to register by hand. Clone uses an SSH key (PEM) or an HTTPS token depending
// on the stored secret's shape. Fully testable via an injected secret reader.
export function createManualProvider(deps: {
  readSecret: (ref: string) => Promise<string>;
}): VcsProvider {
  return {
    kind: "manual",

    listRepos(): Promise<RepoRef[]> {
      return Promise.reject(
        new Error("listing repos isn't supported for manual connections — enter the repo URL"),
      );
    },

    async getCloneCredential(conn: VcsConnection, repo: RepoRef): Promise<CloneCredential> {
      if (!conn.tokenSecretRef) return buildCloneCredential(repo, { type: "none" });
      const secret = await deps.readSecret(conn.tokenSecretRef);
      if (looksLikeSshKey(secret)) {
        return { scheme: "ssh-key", url: httpsToSsh(repo.cloneUrl), keyRef: conn.tokenSecretRef };
      }
      return buildCloneCredential(repo, { type: "token", token: secret });
    },

    // No API call — the UI surfaces the ingest URL + secret to paste.
    registerWebhook(): Promise<RegisteredWebhook> {
      return Promise.resolve({ remoteId: null, manual: true });
    },

    // Manual hooks are user-managed; nothing to delete remotely.
    removeWebhook(): Promise<void> {
      return Promise.resolve();
    },
  };
}
