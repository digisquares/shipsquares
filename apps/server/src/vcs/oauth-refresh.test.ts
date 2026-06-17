import { describe, expect, it, vi } from "vitest";

import {
  ensureFreshToken,
  type OauthCredential,
  parseOauthCredential,
  serializeOauthCredential,
  shouldRefreshToken,
} from "./oauth-refresh.js";

const NOW = 1_000_000;

describe("shouldRefreshToken", () => {
  it("does not refresh a token comfortably before expiry", () => {
    expect(shouldRefreshToken(NOW + 60 * 60_000, NOW)).toBe(false); // expires in 1h
  });

  it("refreshes once within the safety margin of expiry", () => {
    expect(shouldRefreshToken(NOW + 4 * 60_000, NOW)).toBe(true); // expires in 4 min (< 5 min margin)
  });

  it("refreshes an already-expired token", () => {
    expect(shouldRefreshToken(NOW - 1, NOW)).toBe(true);
  });

  it("never refreshes a non-expiring credential (null expiry)", () => {
    expect(shouldRefreshToken(null, NOW)).toBe(false);
    expect(shouldRefreshToken(undefined, NOW)).toBe(false);
  });

  it("honors a custom margin", () => {
    expect(shouldRefreshToken(NOW + 4 * 60_000, NOW, 60_000)).toBe(false); // 1-min margin
  });
});

describe("parseOauthCredential", () => {
  it("parses a JSON credential", () => {
    expect(parseOauthCredential('{"accessToken":"a","refreshToken":"r","expiresAt":5}')).toEqual({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: 5,
    });
  });
  it("treats a bare/invalid string as the access token", () => {
    expect(parseOauthCredential("gho_bare")).toEqual({ accessToken: "gho_bare" });
    expect(parseOauthCredential("{not json")).toEqual({ accessToken: "{not json" });
  });
  it("round-trips via serialize", () => {
    const cred: OauthCredential = { accessToken: "a", refreshToken: "r", expiresAt: 9 };
    expect(parseOauthCredential(serializeOauthCredential(cred))).toEqual(cred);
  });
});

describe("ensureFreshToken", () => {
  const refreshed: OauthCredential = {
    accessToken: "new",
    refreshToken: "r2",
    expiresAt: NOW + 3_600_000,
  };

  it("refreshes when near expiry and a refresh token exists", async () => {
    const refresh = vi.fn(async () => refreshed);
    const out = await ensureFreshToken(
      { accessToken: "old", refreshToken: "r", expiresAt: NOW + 60_000 },
      NOW,
      refresh,
    );
    expect(out).toBe(refreshed);
    expect(refresh).toHaveBeenCalledWith("r");
  });

  it("does not refresh when the token is comfortably valid", async () => {
    const refresh = vi.fn(async () => refreshed);
    const cred: OauthCredential = {
      accessToken: "ok",
      refreshToken: "r",
      expiresAt: NOW + 60 * 60_000,
    };
    expect(await ensureFreshToken(cred, NOW, refresh)).toBe(cred);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("never refreshes without a refresh token; valid tokens pass through", async () => {
    const refresh = vi.fn(async () => refreshed);
    const valid: OauthCredential = { accessToken: "pat" }; // non-expiring PAT
    expect(await ensureFreshToken(valid, NOW, refresh)).toBe(valid);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("signals reconnect-required for an expired credential with no refresh token", async () => {
    const refresh = vi.fn(async () => refreshed);
    const expired: OauthCredential = { accessToken: "pat", expiresAt: NOW - 1 };
    await expect(ensureFreshToken(expired, NOW, refresh)).rejects.toMatchObject({
      code: "vcs.token_expired",
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
