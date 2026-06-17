import { describe, expect, it } from "vitest";

import { signOutbound, verifyOutbound } from "./sign.js";

describe("outbound signing", () => {
  it("produces a sha256= HMAC and verifies it", () => {
    const body = JSON.stringify({ event: "deploy.succeeded" });
    const sig = signOutbound(body, "wsec");
    expect(sig.startsWith("sha256=")).toBe(true);
    expect(verifyOutbound(body, sig, "wsec")).toBe(true);
  });

  it("rejects a forged signature or wrong secret", () => {
    const body = "{}";
    expect(verifyOutbound(body, "sha256=deadbeef", "wsec")).toBe(false);
    expect(verifyOutbound(body, signOutbound(body, "wsec"), "other")).toBe(false);
  });
});
