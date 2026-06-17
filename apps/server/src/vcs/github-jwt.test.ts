import { createVerify, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decodeJwtClaims, generateAppJwt } from "./github-jwt.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

describe("generateAppJwt", () => {
  const now = 1_700_000_000;

  it("mints an RS256 JWT with backdated iat, +10min exp, and iss=appId", () => {
    const jwt = generateAppJwt("123456", privatePem, now);
    expect(jwt.split(".")).toHaveLength(3);
    expect(decodeJwtClaims(jwt)).toEqual({ iat: now - 60, exp: now + 600, iss: "123456" });
  });

  it("produces a signature verifiable with the App public key", () => {
    const jwt = generateAppJwt("123456", privatePem, now);
    const parts = jwt.split(".");
    const signingInput = `${parts[0]}.${parts[1]}`;
    const signature = Buffer.from(parts[2] ?? "", "base64url");
    const ok = createVerify("RSA-SHA256").update(signingInput).verify(publicPem, signature);
    expect(ok).toBe(true);
  });
});
