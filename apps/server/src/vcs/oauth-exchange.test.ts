import { describe, expect, it, vi } from "vitest";

import { exchangeRefreshToken, oauthTokenUrl, type FetchLike } from "./oauth-exchange.js";

const NOW = 1_000_000;
const CFG = { tokenUrl: "https://gitlab.com/oauth/token", clientId: "cid", clientSecret: "sec" };

const okFetch = (payload: unknown): FetchLike =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => payload }));

describe("oauthTokenUrl", () => {
  it("knows the hosted endpoints; per-instance providers return null", () => {
    expect(oauthTokenUrl("github")).toBe("https://github.com/login/oauth/access_token");
    expect(oauthTokenUrl("gitlab")).toBe("https://gitlab.com/oauth/token");
    expect(oauthTokenUrl("gitea")).toBeNull();
    expect(oauthTokenUrl("bitbucket")).toBeNull();
  });
});

describe("exchangeRefreshToken", () => {
  it("posts the refresh grant and maps the response (absolute expiry)", async () => {
    const fetchFn = okFetch({ access_token: "new", refresh_token: "r2", expires_in: 7200 });
    const cred = await exchangeRefreshToken(CFG, "r1", fetchFn, () => NOW);
    expect(cred).toEqual({ accessToken: "new", refreshToken: "r2", expiresAt: NOW + 7200_000 });
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { body: string; headers: Record<string, string> },
    ];
    expect(url).toBe(CFG.tokenUrl);
    const params = new URLSearchParams(init.body);
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("r1");
    expect(params.get("client_id")).toBe("cid");
    expect(init.headers.accept).toBe("application/json");
  });

  it("keeps the old refresh token when the provider does not rotate", async () => {
    const cred = await exchangeRefreshToken(CFG, "r1", okFetch({ access_token: "new" }), () => NOW);
    expect(cred.refreshToken).toBe("r1");
    expect(cred.expiresAt).toBeUndefined();
  });

  it("throws on HTTP errors and on responses without access_token", async () => {
    const bad: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({}) });
    await expect(exchangeRefreshToken(CFG, "r1", bad)).rejects.toThrow("HTTP 401");
    await expect(
      exchangeRefreshToken(CFG, "r1", okFetch({ error: "invalid_grant" })),
    ).rejects.toThrow("no access_token");
  });
});
