import { type OauthCredential } from "./oauth-refresh.js";

// OAuth refresh-token exchange (26-vcs-connections.md), adapted from Dokploy's
// providers/gitlab.ts refresh flow (Apache-2.0, see NOTICE): POST the token
// endpoint with grant_type=refresh_token, map the standard response, compute
// absolute expiry from expires_in. Pure — fetch is injected.

export interface OauthClientConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

/** Hosted token endpoints per provider. Gitea/Bitbucket are per-instance —
 *  they need an instance URL on the connection (follow-up). */
export function oauthTokenUrl(provider: string): string | null {
  if (provider === "github") return "https://github.com/login/oauth/access_token";
  if (provider === "gitlab") return "https://gitlab.com/oauth/token";
  return null;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number; // seconds
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function exchangeRefreshToken(
  cfg: OauthClientConfig,
  refreshToken: string,
  fetchFn: FetchLike,
  now: () => number = () => Date.now(),
): Promise<OauthCredential> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetchFn(cfg.tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`oauth token refresh failed: HTTP ${res.status}`);
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token) throw new Error("oauth token refresh failed: no access_token");
  return {
    accessToken: data.access_token,
    // Providers that rotate refresh tokens return a new one; keep the old
    // otherwise so the next refresh still works.
    refreshToken: data.refresh_token ?? refreshToken,
    ...(data.expires_in ? { expiresAt: now() + data.expires_in * 1000 } : {}),
  };
}
