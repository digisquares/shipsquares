import { describe, expect, it, vi } from "vitest";

import { type VcsConnection } from "../types.js";

import { createManualProvider } from "./manual.js";

const conn = (tokenSecretRef: string | null = "secret_1"): VcsConnection => ({
  id: "vcs_1",
  organizationId: "org_1",
  provider: "github",
  kind: "manual",
  accountLogin: "acme",
  installationId: null,
  githubAppId: null,
  tokenSecretRef,
});

const repo = {
  owner: "acme",
  name: "web",
  fullName: "acme/web",
  defaultBranch: "main",
  private: true,
  cloneUrl: "https://github.com/acme/web.git",
};

describe("manual provider", () => {
  it("does not support listing repos", async () => {
    const p = createManualProvider({ readSecret: vi.fn() });
    await expect(p.listRepos(conn())).rejects.toThrow(/not supported|enter the repo/i);
  });

  it("uses an SSH deploy key when the secret is a PEM private key", async () => {
    const p = createManualProvider({
      readSecret: async () => "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END...",
    });
    expect(await p.getCloneCredential(conn(), repo)).toEqual({
      scheme: "ssh-key",
      url: "git@github.com:acme/web.git",
      keyRef: "secret_1",
    });
  });

  it("uses an HTTPS token when the secret is a PAT", async () => {
    const p = createManualProvider({ readSecret: async () => "ghp_token" });
    expect(await p.getCloneCredential(conn(), repo)).toEqual({
      scheme: "https-token",
      url: "https://x-access-token:ghp_token@github.com/acme/web.git",
      token: "ghp_token",
    });
  });

  it("falls back to a token-less clone when there is no stored secret", async () => {
    const readSecret = vi.fn();
    const p = createManualProvider({ readSecret });
    expect(await p.getCloneCredential(conn(null), repo)).toEqual({
      scheme: "https-token",
      url: repo.cloneUrl,
      token: "",
    });
    expect(readSecret).not.toHaveBeenCalled();
  });

  it("registers no remote webhook (manual paste)", async () => {
    const p = createManualProvider({ readSecret: vi.fn() });
    expect(
      await p.registerWebhook(conn(), repo, { ingestUrl: "u", secret: "s", events: ["push"] }),
    ).toEqual({ remoteId: null, manual: true });
  });

  it("remove webhook is a no-op", async () => {
    const p = createManualProvider({ readSecret: vi.fn() });
    await expect(p.removeWebhook(conn(), repo, "x")).resolves.toBeUndefined();
  });
});
