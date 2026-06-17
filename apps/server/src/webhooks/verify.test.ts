import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { bitbucketVerify, githubVerify, giteaVerify, gitlabVerify } from "./verify.js";

const secret = "whsec_test";
const body = JSON.stringify({ ref: "refs/heads/main" });

describe("signature verification", () => {
  it("githubVerify accepts a correctly signed body and rejects a forgery", () => {
    const sig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(githubVerify(body, sig, secret)).toBe(true);
    expect(githubVerify(`${body} tampered`, sig, secret)).toBe(false);
    expect(githubVerify(body, "sha256=deadbeef", secret)).toBe(false);
    expect(githubVerify(body, undefined, secret)).toBe(false);
  });

  it("giteaVerify uses a prefix-less hex HMAC", () => {
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    expect(giteaVerify(body, sig, secret)).toBe(true);
    expect(giteaVerify(`${body}x`, sig, secret)).toBe(false);
  });

  it("gitlabVerify constant-time-equals the token to the secret", () => {
    expect(gitlabVerify(secret, secret)).toBe(true);
    expect(gitlabVerify("wrong", secret)).toBe(false);
    expect(gitlabVerify(undefined, secret)).toBe(false);
  });

  it("bitbucketVerify checks the secret path token", () => {
    expect(bitbucketVerify("tok_abc", "tok_abc")).toBe(true);
    expect(bitbucketVerify("tok_xyz", "tok_abc")).toBe(false);
  });
});
