import { describe, expect, it } from "vitest";

import { buildCloneCredential } from "./clone-credential.js";
import { type RepoRef } from "./types.js";

const repo: RepoRef = {
  owner: "acme",
  name: "web",
  fullName: "acme/web",
  defaultBranch: "main",
  private: true,
  cloneUrl: "https://github.com/acme/web.git",
};

describe("buildCloneCredential", () => {
  it("injects a token into the https url (app/oauth/manual-PAT)", () => {
    const cred = buildCloneCredential(repo, { type: "token", token: "ghs_abc" });
    expect(cred).toEqual({
      scheme: "https-token",
      url: "https://x-access-token:ghs_abc@github.com/acme/web.git",
      token: "ghs_abc",
    });
  });

  it("returns an ssh-key credential for a manual deploy key", () => {
    const cred = buildCloneCredential(repo, {
      type: "ssh-key",
      keyRef: "secret_xyz",
      sshUrl: "git@github.com:acme/web.git",
    });
    expect(cred).toEqual({
      scheme: "ssh-key",
      url: "git@github.com:acme/web.git",
      keyRef: "secret_xyz",
    });
  });

  it("returns a token-less https url for a public repo", () => {
    const cred = buildCloneCredential(repo, { type: "none" });
    expect(cred).toEqual({ scheme: "https-token", url: repo.cloneUrl, token: "" });
  });

  it("rejects token clone over a non-https url", () => {
    const httpRepo = { ...repo, cloneUrl: "http://github.com/acme/web.git" };
    expect(() => buildCloneCredential(httpRepo, { type: "token", token: "x" })).toThrow();
  });
});
