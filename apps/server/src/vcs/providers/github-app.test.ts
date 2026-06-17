import { describe, expect, it, vi } from "vitest";

import { createTokenCache } from "../token-cache.js";
import { type VcsConnection } from "../types.js";

import { createGithubAppProvider, type OctokitLike, resolveConnectionKey } from "./github-app.js";

const conn: VcsConnection = {
  id: "vcs_1",
  organizationId: "org_1",
  provider: "github",
  kind: "github_app",
  accountLogin: "acme",
  installationId: "42",
  githubAppId: "1001",
  tokenSecretRef: "secret_pk",
};

const repo = {
  owner: "acme",
  name: "web",
  fullName: "acme/web",
  defaultBranch: "main",
  private: true,
  cloneUrl: "https://github.com/acme/web.git",
};

function fakeOctokit(over: Partial<OctokitLike> = {}): OctokitLike {
  return {
    auth: vi.fn(async () => ({ token: "ghs_minted", expiresAt: "2099-01-01T00:00:00Z" })),
    paginate: vi.fn(async () => [
      {
        name: "web",
        full_name: "acme/web",
        owner: { login: "acme" },
        default_branch: "main",
        private: true,
        clone_url: "https://github.com/acme/web.git",
      },
    ]),
    rest: {
      apps: { listReposAccessibleToInstallation: {} },
      repos: {
        listBranches: {},
        createWebhook: vi.fn(async () => ({ data: { id: 555 } })),
        deleteWebhook: vi.fn(async () => ({})),
      },
    },
    ...over,
  };
}

describe("github-app provider", () => {
  it("mints an installation token and caches it (no second auth within TTL)", async () => {
    const ok = fakeOctokit();
    const p = createGithubAppProvider({ octokitFor: async () => ok, now: () => 1000 });
    expect(await p.installationToken(conn)).toBe("ghs_minted");
    expect(await p.installationToken(conn)).toBe("ghs_minted");
    expect(ok.auth).toHaveBeenCalledTimes(1); // second call served from cache
  });

  it("re-mints when the cached token is near expiry", async () => {
    const ok = fakeOctokit({
      auth: vi.fn(async () => ({ token: "t", expiresAt: new Date(10_000).toISOString() })),
    });
    // cache holds {expiresAt: 10_000}; query at 9_000 is within the 5-min margin → re-mint
    const p = createGithubAppProvider({ octokitFor: async () => ok, now: () => 9_000 });
    await p.installationToken(conn);
    await p.installationToken(conn);
    expect(ok.auth).toHaveBeenCalledTimes(2);
  });

  it("lists repos mapped to RepoRef", async () => {
    const p = createGithubAppProvider({ octokitFor: async () => fakeOctokit() });
    const repos = await p.listRepos(conn);
    expect(repos).toEqual([
      {
        owner: "acme",
        name: "web",
        fullName: "acme/web",
        defaultBranch: "main",
        private: true,
        cloneUrl: "https://github.com/acme/web.git",
      },
    ]);
  });

  it("lists branches mapped to BranchRef", async () => {
    const ok = fakeOctokit({
      paginate: vi.fn(async () => [
        { name: "main", commit: { sha: "abc123" }, protected: true },
        { name: "dev", commit: { sha: "def456" } },
      ]),
    });
    const p = createGithubAppProvider({ octokitFor: async () => ok });
    const branches = await p.listBranches!(conn, "acme", "web");
    expect(branches).toEqual([
      { name: "main", commit: "abc123", protected: true },
      { name: "dev", commit: "def456", protected: false },
    ]);
    expect(ok.paginate).toHaveBeenCalledWith(ok.rest.repos.listBranches, {
      owner: "acme",
      repo: "web",
    });
  });

  it("builds a clone credential with a freshly minted token", async () => {
    const p = createGithubAppProvider({ octokitFor: async () => fakeOctokit() });
    const cred = await p.getCloneCredential(conn, repo);
    expect(cred).toEqual({
      scheme: "https-token",
      url: "https://x-access-token:ghs_minted@github.com/acme/web.git",
      token: "ghs_minted",
    });
  });

  it("registers a push webhook (json, our url+secret) and returns the remote id", async () => {
    const ok = fakeOctokit();
    const p = createGithubAppProvider({ octokitFor: async () => ok });
    const res = await p.registerWebhook(conn, repo, {
      ingestUrl: "https://ctrl/hooks/ihk_1",
      secret: "s3cr3t",
      events: ["push"],
    });
    expect(res).toEqual({ remoteId: "555", manual: false });
    expect(ok.rest.repos.createWebhook).toHaveBeenCalledWith({
      owner: "acme",
      repo: "web",
      events: ["push"],
      active: true,
      config: { url: "https://ctrl/hooks/ihk_1", secret: "s3cr3t", content_type: "json" },
    });
  });

  it("resolveConnectionKey: prefers the linked registration key, else the sealed ref", async () => {
    const src = {
      readSecret: vi.fn(async () => "from-ref"),
      registrationKey: vi.fn(async () => "from-reg"),
    };
    expect(
      await resolveConnectionKey(
        { ...conn, appRegistrationId: "vca_1", tokenSecretRef: null },
        src,
      ),
    ).toBe("from-reg");
    expect(src.registrationKey).toHaveBeenCalledWith("vca_1");
    expect(src.readSecret).not.toHaveBeenCalled();

    expect(
      await resolveConnectionKey(
        { ...conn, appRegistrationId: null, tokenSecretRef: "secret_pk" },
        src,
      ),
    ).toBe("from-ref");
    expect(src.readSecret).toHaveBeenCalledWith("secret_pk");
  });

  it("removes a webhook by repo + remote id", async () => {
    const ok = fakeOctokit();
    const p = createGithubAppProvider({ octokitFor: async () => ok, cache: createTokenCache() });
    await p.removeWebhook(conn, repo, "555");
    expect(ok.rest.repos.deleteWebhook).toHaveBeenCalledWith({
      owner: "acme",
      repo: "web",
      hook_id: 555,
    });
  });
});
