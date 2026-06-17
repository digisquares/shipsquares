import { describe, expect, it } from "vitest";

import { httpsToSsh, looksLikeSshKey } from "./git-url.js";

describe("looksLikeSshKey", () => {
  it("recognizes PEM private keys", () => {
    expect(looksLikeSshKey("-----BEGIN OPENSSH PRIVATE KEY-----\n...")).toBe(true);
    expect(looksLikeSshKey("-----BEGIN RSA PRIVATE KEY-----\n...")).toBe(true);
    expect(looksLikeSshKey("-----BEGIN PRIVATE KEY-----\n...")).toBe(true);
  });
  it("treats a token/PAT as not-a-key", () => {
    expect(looksLikeSshKey("ghp_abcdef0123456789")).toBe(false);
    expect(looksLikeSshKey("github_pat_xxx")).toBe(false);
  });
});

describe("httpsToSsh", () => {
  it("converts an https clone url to scp-style ssh", () => {
    expect(httpsToSsh("https://github.com/acme/web.git")).toBe("git@github.com:acme/web.git");
  });
  it("tolerates a trailing slash", () => {
    expect(httpsToSsh("https://gitlab.com/group/sub/repo/")).toBe("git@gitlab.com:group/sub/repo");
  });
});
