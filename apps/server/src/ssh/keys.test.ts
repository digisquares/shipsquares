import { describe, expect, it } from "vitest";

import { generateSshKeyPair } from "./keys.js";

describe("generateSshKeyPair", () => {
  it("generates an ed25519 pair by default", () => {
    const pair = generateSshKeyPair();
    expect(pair.privateKey).toContain("PRIVATE KEY");
    expect(pair.publicKey.startsWith("ssh-ed25519 ")).toBe(true);
    expect(generateSshKeyPair().publicKey).not.toBe(pair.publicKey); // fresh each call
  });

  it("generates rsa with configurable bits", () => {
    const pair = generateSshKeyPair("rsa", { bits: 2048 });
    expect(pair.privateKey).toContain("PRIVATE KEY");
    expect(pair.publicKey.startsWith("ssh-rsa ")).toBe(true);
  });
});
