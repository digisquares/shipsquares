import { Octokit } from "octokit";

import { buildCloneCredential } from "../clone-credential.js";
import { ensureFreshToken, type OauthCredential, parseOauthCredential } from "../oauth-refresh.js";
import { type GithubRepo, toRepoRef } from "../repo-ref.js";
import {
  type CloneCredential,
  type RegisteredWebhook,
  type RepoRef,
  type VcsConnection,
  type VcsProvider,
  type WebhookSpec,
} from "../types.js";

// OAuth-kind provider (26-vcs-connections.md): a user-scoped token from the
// secret store (sealed JSON {accessToken, refreshToken?, expiresAt?}). Before
// each call it resolves a **fresh** access token — refreshing within the safety
// margin when a refresh token exists — and persists the rotated credential. All
// boundaries (secret read, token-Octokit, refresh exchange, persist) are
// injected, so the logic is unit-testable.

/** The slice of a user-token Octokit this provider uses. */
export interface OauthOctokitLike {
  paginate(route: unknown): Promise<GithubRepo[]>;
  rest: {
    repos: {
      listForAuthenticatedUser: unknown;
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

export type OauthTokenOctokitFactory = (token: string) => OauthOctokitLike;

/** Real factory: a user-token-authed Octokit. */
export function defaultOauthOctokitForToken(token: string): OauthOctokitLike {
  return new Octokit({ auth: token }) as unknown as OauthOctokitLike;
}

export interface OauthProviderDeps {
  readSecret: (ref: string) => Promise<string>;
  octokitForToken: OauthTokenOctokitFactory;
  /** exchange a refresh token for a fresh credential (provider token endpoint) */
  refresh: (conn: VcsConnection, refreshToken: string) => Promise<OauthCredential>;
  /** write the rotated credential back (re-seal + update token_expires_at) */
  persist: (conn: VcsConnection, cred: OauthCredential) => Promise<void>;
  now?: () => number;
}

export function createOauthProvider(deps: OauthProviderDeps): VcsProvider {
  const now = deps.now ?? (() => Date.now());

  async function accessToken(conn: VcsConnection): Promise<string> {
    const cred = parseOauthCredential(await deps.readSecret(conn.tokenSecretRef!));
    const fresh = await ensureFreshToken(cred, now(), (rt) => deps.refresh(conn, rt));
    if (fresh !== cred) {
      // Rotating IdPs have already invalidated the old refresh token — the fresh
      // credential must be USED even if the write-back fails (it is retried on
      // the next refresh; failing here would brick the connection).
      try {
        await deps.persist(conn, fresh);
      } catch {
        /* persist retried on the next refresh */
      }
    }
    return fresh.accessToken;
  }

  return {
    kind: "oauth",

    async listRepos(conn: VcsConnection): Promise<RepoRef[]> {
      const ok = deps.octokitForToken(await accessToken(conn));
      const repos = await ok.paginate(ok.rest.repos.listForAuthenticatedUser);
      return repos.map(toRepoRef);
    },

    async getCloneCredential(conn: VcsConnection, repo: RepoRef): Promise<CloneCredential> {
      return buildCloneCredential(repo, { type: "token", token: await accessToken(conn) });
    },

    async registerWebhook(
      conn: VcsConnection,
      repo: RepoRef,
      spec: WebhookSpec,
    ): Promise<RegisteredWebhook> {
      const ok = deps.octokitForToken(await accessToken(conn));
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
      const ok = deps.octokitForToken(await accessToken(conn));
      await ok.rest.repos.deleteWebhook({
        owner: repo.owner,
        repo: repo.name,
        hook_id: Number(remoteId),
      });
    },
  };
}
