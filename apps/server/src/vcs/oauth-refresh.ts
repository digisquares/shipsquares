// OAuth token refresh timing (26-vcs-connections.md). Mirrors Dokploy's
// `currentTime + safetyMargin < expiresAt` rule: refresh once the token is within
// the safety margin of expiry. A null expiry (e.g. a non-expiring PAT) never
// refreshes. Pure; the actual token exchange is runtime.

const DEFAULT_MARGIN_MS = 5 * 60_000;

export function shouldRefreshToken(
  expiresAt: number | null | undefined,
  now: number,
  marginMs: number = DEFAULT_MARGIN_MS,
): boolean {
  if (expiresAt == null) return false;
  return now + marginMs >= expiresAt;
}

// An OAuth credential as stored (sealed) in tokenSecretRef.
export interface OauthCredential {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms */
  expiresAt?: number;
}

// Parse a stored credential — a JSON {accessToken, refreshToken?, expiresAt?} or
// a bare access-token string (lenient, so a PAT-style ref still works).
export function parseOauthCredential(stored: string): OauthCredential {
  try {
    const v: unknown = JSON.parse(stored);
    if (v && typeof v === "object" && typeof (v as OauthCredential).accessToken === "string") {
      return v as OauthCredential;
    }
  } catch {
    /* not JSON — treat the whole string as the access token */
  }
  return { accessToken: stored };
}

export function serializeOauthCredential(cred: OauthCredential): string {
  return JSON.stringify(cred);
}

/** Thrown when the stored token is expired and cannot be refreshed — the user
 *  must reconnect the provider. Carries a code the API/UI can phrase. */
export class TokenExpiredError extends Error {
  readonly code = "vcs.token_expired";
  constructor() {
    super("the stored token has expired — reconnect this git provider");
  }
}

// Return a still-valid credential: if the access token is within the refresh
// margin of expiry AND a refresh token exists, exchange it; else return as-is.
// An already-expired credential with no refresh token is signalled clearly
// instead of flowing into provider calls as an opaque 401. The exchange (HTTP)
// is injected so this orchestration is unit-testable.
export async function ensureFreshToken(
  cred: OauthCredential,
  now: number,
  refresh: (refreshToken: string) => Promise<OauthCredential>,
  marginMs?: number,
): Promise<OauthCredential> {
  if (!cred.refreshToken) {
    if (cred.expiresAt != null && cred.expiresAt <= now) throw new TokenExpiredError();
    return cred;
  }
  if (!shouldRefreshToken(cred.expiresAt ?? null, now, marginMs)) return cred;
  return refresh(cred.refreshToken);
}
