import { describe, expect, it, vi } from "vitest";

import { serializeOauthCredential } from "../oauth-refresh.js";
import { type VcsConnection } from "../types.js";

import { createOauthProvider, type OauthOctokitLike } from "./oauth.js";

const conn: VcsConnection = {
  id: "vcs_1",
  organizationId: "org_1",
  provider: "github",
  kind: "oauth",
  accountLogin: "dev",
  installationId: null,
  githubAppId: null,
  tokenSecretRef: "secret_oauth",
};

const repo = {
  owner: "dev",
  name: "site",
  fullName: "dev/site",
  defaultBranch: "main",
  private: false,
  cloneUrl: "https://github.com/dev/site.git",
};

function fakeOctokit(): OauthOctokitLike {
  return {
    paginate: vi.fn(async () => [
      {
        name: "site",
        full_name: "dev/site",
        owner: { login: "dev" },
        default_branch: "main",
        private: false,
        clone_url: "https://github.com/dev/site.git",
      },
    ]),
    rest: {
      repos: {
        listForAuthenticatedUser: {},
        createWebhook: vi.fn(async () => ({ data: { id: 909 } })),
        deleteWebhook: vi.fn(async () => ({})),
      },
    },
  };
}

// A non-expiring stored credential (no refresh needed).
const STATIC = serializeOauthCredential({ accessToken: "gho_usertoken" });

function makeProvider(over: Partial<Parameters<typeof createOauthProvider>[0]> = {}) {
  return createOauthProvider({
    readSecret: async () => STATIC,
    octokitForToken: () => fakeOctokit(),
    refresh: vi.fn(async () => ({ accessToken: "should-not-be-used" })),
    persist: vi.fn(async () => {}),
    ...over,
  });
}

describe("oauth provider", () => {
  it("clones with the stored access token", async () => {
    const p = makeProvider();
    expect(await p.getCloneCredential(conn, repo)).toEqual({
      scheme: "https-token",
      url: "https://x-access-token:gho_usertoken@github.com/dev/site.git",
      token: "gho_usertoken",
    });
  });

  it("lists the authenticated user's repos mapped to RepoRef", async () => {
    const p = makeProvider();
    expect((await p.listRepos(conn)).map((r) => r.fullName)).toEqual(["dev/site"]);
  });

  it("refreshes a near-expiry token and persists the rotated credential", async () => {
    const NOW = 1_000_000;
    const stale = serializeOauthCredential({
      accessToken: "old",
      refreshToken: "r",
      expiresAt: NOW + 60_000, // within the 5-min margin
    });
    const refresh = vi.fn(async () => ({ accessToken: "fresh", refreshToken: "r2" }));
    const persist = vi.fn(async () => {});
    const p = makeProvider({ readSecret: async () => stale, refresh, persist, now: () => NOW });

    const cred = await p.getCloneCredential(conn, repo);
    expect(cred).toMatchObject({ token: "fresh" });
    expect(refresh).toHaveBeenCalledWith(conn, "r");
    expect(persist).toHaveBeenCalledWith(conn, { accessToken: "fresh", refreshToken: "r2" });
  });

  it("still uses the fresh token when the write-back fails (rotated refresh tokens)", async () => {
    const NOW = 1_000_000;
    const stale = serializeOauthCredential({
      accessToken: "old",
      refreshToken: "r",
      expiresAt: NOW + 60_000,
    });
    const refresh = vi.fn(async () => ({ accessToken: "fresh", refreshToken: "r2" }));
    const persist = vi.fn(async () => {
      throw new Error("db down");
    });
    const p = makeProvider({ readSecret: async () => stale, refresh, persist, now: () => NOW });
    const cred = await p.getCloneCredential(conn, repo);
    expect(cred).toMatchObject({ token: "fresh" }); // not the stale one, no throw
    expect(persist).toHaveBeenCalled();
  });

  it("does not refresh or persist a static token", async () => {
    const refresh = vi.fn();
    const persist = vi.fn();
    const p = makeProvider({ refresh, persist });
    await p.listRepos(conn);
    expect(refresh).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("registers a push webhook and removes by repo + remote id", async () => {
    const ok = fakeOctokit();
    const p = makeProvider({ octokitForToken: () => ok });
    expect(
      await p.registerWebhook(conn, repo, {
        ingestUrl: "https://c/hooks/w",
        secret: "s",
        events: ["push"],
      }),
    ).toEqual({ remoteId: "909", manual: false });
    await p.removeWebhook(conn, repo, "909");
    expect(ok.rest.repos.deleteWebhook).toHaveBeenCalledWith({
      owner: "dev",
      repo: "site",
      hook_id: 909,
    });
  });
});
