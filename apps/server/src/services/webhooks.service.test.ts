import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { matchAppsByRepo, verifyInboundSignature } from "./webhooks.service.js";

const secret = "topsecret";
const body = Buffer.from(JSON.stringify({ ref: "refs/heads/main" }));

describe("verifyInboundSignature", () => {
  it("accepts a valid GitHub X-Hub-Signature-256 and rejects a wrong/missing one", () => {
    const sig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyInboundSignature("github", body, { "x-hub-signature-256": sig }, secret)).toBe(
      true,
    );
    expect(
      verifyInboundSignature("github", body, { "x-hub-signature-256": "sha256=deadbeef" }, secret),
    ).toBe(false);
    expect(verifyInboundSignature("github", body, {}, secret)).toBe(false);
  });

  it("accepts a valid Gitea signature (no sha256= prefix)", () => {
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyInboundSignature("gitea", body, { "x-gitea-signature": sig }, secret)).toBe(true);
  });

  it("checks the GitLab token by constant-time equality", () => {
    expect(verifyInboundSignature("gitlab", body, { "x-gitlab-token": secret }, secret)).toBe(true);
    expect(verifyInboundSignature("gitlab", body, { "x-gitlab-token": "nope" }, secret)).toBe(
      false,
    );
  });

  it("bitbucket authenticates via the ?token= URL secret, never the headers", () => {
    expect(verifyInboundSignature("bitbucket", body, {}, secret, secret)).toBe(true);
    expect(verifyInboundSignature("bitbucket", body, {}, secret, "nope")).toBe(false);
    expect(verifyInboundSignature("bitbucket", body, {}, secret)).toBe(false);
    // a header can never stand in for the URL token
    expect(verifyInboundSignature("bitbucket", body, { "x-token": secret }, secret)).toBe(false);
  });
});

describe("matchAppsByRepo", () => {
  const mk = (repo: string | null, branch = "main") => ({ repo, branch });

  it("matches apps whose git URL resolves to the payload repo, case-insensitively", () => {
    const out = matchAppsByRepo(
      [
        mk("https://github.com/Acme/Web.git"),
        mk("https://github.com/acme/other.git"),
        mk("https://github.com/acme/web"), // no .git suffix still resolves
      ],
      "acme/web",
    );
    expect(out).toEqual([
      { repo: "https://github.com/Acme/Web.git", branch: "main" },
      { repo: "https://github.com/acme/web", branch: "main" },
    ]);
  });

  it("never matches apps without a parseable https repo (ssh / catalog / image)", () => {
    expect(matchAppsByRepo([mk(null), mk("git@github.com:acme/web.git")], "acme/web")).toEqual([]);
  });

  it("returns nothing for an empty repo full name", () => {
    expect(matchAppsByRepo([mk("https://github.com/acme/web.git")], "")).toEqual([]);
  });
});
