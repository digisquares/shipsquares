import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";

import { buildCloneCredential } from "../clone-credential.js";
import { type GithubBranch, type GithubRepo, toBranchRef, toRepoRef } from "../repo-ref.js";
import { createTokenCache, type TokenCache } from "../token-cache.js";
import {
  type BranchRef,
  type CloneCredential,
  type RegisteredWebhook,
  type RepoRef,
  type VcsConnection,
  type VcsProvider,
  type WebhookSpec,
} from "../types.js";

// GitHub App provider (26-vcs-connections.md): installation-token mint+cache,
// repo listing, push-webhook register/remove. The Octokit boundary is injected
// (OctokitFactory) so the logic is unit-testable with a fake — the default
// factory builds a real App-authed Octokit from the secret-store private key.

interface InstallationAuth {
  token: string;
  expiresAt: string;
}

/** The slice of Octokit this provider uses. */
export interface OctokitLike {
  auth(opts: { type: "installation" }): Promise<InstallationAuth>;
  paginate(route: unknown, params?: Record<string, unknown>): Promise<unknown[]>;
  rest: {
    apps: { listReposAccessibleToInstallation: unknown };
    repos: {
      listBranches: unknown;
      createWebhook(args: {
        owner: string;
        repo: string;
        events: string[];
        active: boolean;
        config: { url: string; secret: string; content_type: string };
      }): Promise<{ data: { id: number } }>;
      deleteWebhook(args: { owner: string; repo: string; hook_id: number }): Promise<unknown>;
    };
  };
}

export type OctokitFactory = (conn: VcsConnection) => Promise<OctokitLike>;

/** Where a connection's App private key comes from. Manifest Apps reference a
 *  shared registration key; env-app / legacy connections seal it per-connection
 *  in tokenSecretRef. */
export interface KeySource {
  readSecret(ref: string): Promise<string>;
  registrationKey(registrationId: string): Promise<string>;
}

/** Pure: pick the key source for a connection (R2.7). Registration link wins;
 *  otherwise the per-connection sealed ref. Unit-tested with a fake source. */
export function resolveConnectionKey(conn: VcsConnection, src: KeySource): Promise<string> {
  if (conn.appRegistrationId) return src.registrationKey(conn.appRegistrationId);
  return src.readSecret(conn.tokenSecretRef!);
}

/** Real factory: an App-installation-authed Octokit, private key resolved from
 *  the registration (shared) or the secret store (per-connection). */
export function defaultOctokitFor(src: KeySource): OctokitFactory {
  return async (conn) =>
    new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: conn.githubAppId!,
        installationId: conn.installationId!,
        privateKey: await resolveConnectionKey(conn, src),
      },
    }) as unknown as OctokitLike;
}

export interface GithubAppDeps {
  octokitFor: OctokitFactory;
  cache?: TokenCache;
  now?: () => number;
}

export function createGithubAppProvider(
  deps: GithubAppDeps,
): VcsProvider & { installationToken(conn: VcsConnection): Promise<string> } {
  const cache = deps.cache ?? createTokenCache();
  const now = deps.now ?? (() => Date.now());

  // Mint-on-demand + cache, keyed by installation id; the cache re-mints within
  // 5 min of expiry so a returned token is valid for a whole clone.
  async function installationToken(conn: VcsConnection): Promise<string> {
    const id = conn.installationId!;
    const cached = cache.get(id, now());
    if (cached) return cached;
    const ok = await deps.octokitFor(conn);
    const { token, expiresAt } = await ok.auth({ type: "installation" });
    cache.set(id, { token, expiresAt: Date.parse(expiresAt) });
    return token;
  }

  return {
    kind: "github_app",
    installationToken,

    async listRepos(conn: VcsConnection): Promise<RepoRef[]> {
      const ok = await deps.octokitFor(conn);
      const repos = (await ok.paginate(
        ok.rest.apps.listReposAccessibleToInstallation,
      )) as GithubRepo[];
      return repos.map(toRepoRef);
    },

    async listBranches(conn: VcsConnection, owner: string, repo: string): Promise<BranchRef[]> {
      const ok = await deps.octokitFor(conn);
      const branches = (await ok.paginate(ok.rest.repos.listBranches, {
        owner,
        repo,
      })) as GithubBranch[];
      return branches.map(toBranchRef);
    },

    async getCloneCredential(conn: VcsConnection, repo: RepoRef): Promise<CloneCredential> {
      const token = await installationToken(conn);
      return buildCloneCredential(repo, { type: "token", token });
    },

    async registerWebhook(
      conn: VcsConnection,
      repo: RepoRef,
      spec: WebhookSpec,
    ): Promise<RegisteredWebhook> {
      const ok = await deps.octokitFor(conn);
      const { data } = await ok.rest.repos.createWebhook({
        owner: repo.owner,
        repo: repo.name,
        events: spec.events,
        active: true,
        config: { url: spec.ingestUrl, secret: spec.secret, content_type: "json" },
      });
      return { remoteId: String(data.id), manual: false };
    },

    async removeWebhook(conn: VcsConnection, repo: RepoRef, remoteId: string): Promise<void> {
      const ok = await deps.octokitFor(conn);
      await ok.rest.repos.deleteWebhook({
        owner: repo.owner,
        repo: repo.name,
        hook_id: Number(remoteId),
      });
    },
  };
}
