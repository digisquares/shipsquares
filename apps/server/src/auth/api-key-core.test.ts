import { describe, expect, it } from "vitest";

import { apiKeyDenied, generateApiKey, hashApiKey, parseBearer } from "./api-key-core.js";

describe("api key core", () => {
  it("generates ss_live_ tokens with 48 hex chars of entropy and their hash", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.token).toMatch(/^ss_live_[0-9a-f]{48}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashApiKey(a.token));
    expect(a.hash).not.toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex — the token itself is never stored
  });

  it("hashes deterministically", () => {
    expect(hashApiKey("ss_live_x")).toBe(hashApiKey("ss_live_x"));
  });

  it("parseBearer extracts only our token shape from the Authorization header", () => {
    const t = generateApiKey().token;
    expect(parseBearer(`Bearer ${t}`)).toBe(t);
    expect(parseBearer(`bearer ${t}`)).toBe(t); // scheme is case-insensitive
    expect(parseBearer("Bearer not-our-token")).toBeNull();
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
  });

  it("apiKeyDenied refuses revoked and expired keys, allows live ones (S3)", () => {
    const now = new Date("2026-07-03T12:00:00Z");
    const past = new Date("2026-07-01T00:00:00Z");
    const future = new Date("2026-08-01T00:00:00Z");
    expect(apiKeyDenied({ revokedAt: null, expiresAt: null }, now)).toBeNull();
    expect(apiKeyDenied({ revokedAt: null, expiresAt: future }, now)).toBeNull();
    expect(apiKeyDenied({ revokedAt: null, expiresAt: past }, now)).toBe("expired");
    expect(apiKeyDenied({ revokedAt: null, expiresAt: now }, now)).toBe("expired"); // boundary
    expect(apiKeyDenied({ revokedAt: past, expiresAt: null }, now)).toBe("revoked");
    // revocation wins even when the key is also past expiry
    expect(apiKeyDenied({ revokedAt: past, expiresAt: past }, now)).toBe("revoked");
  });
});
