// Installation-token cache (26-vcs-connections.md). GitHub App installation
// tokens are short-lived (~1h); mint on demand and cache keyed by installation
// id, treating a token within a safety margin of expiry as already stale (so the
// caller re-mints). Pure + injectable clock — the mint itself lives in the
// Octokit-backed provider.

export interface CachedToken {
  token: string;
  /** epoch ms */
  expiresAt: number;
}

const DEFAULT_MARGIN_MS = 5 * 60_000;

export interface TokenCache {
  /** A still-fresh cached token for the installation, or undefined (→ re-mint). */
  get(installationId: string, now: number): string | undefined;
  set(installationId: string, entry: CachedToken): void;
  delete(installationId: string): void;
  readonly size: number;
}

export function createTokenCache(marginMs: number = DEFAULT_MARGIN_MS): TokenCache {
  const store = new Map<string, CachedToken>();
  return {
    get(installationId, now) {
      const hit = store.get(installationId);
      if (hit && hit.expiresAt - now > marginMs) return hit.token;
      return undefined;
    },
    set(installationId, entry) {
      store.set(installationId, entry);
    },
    delete(installationId) {
      store.delete(installationId);
    },
    get size() {
      return store.size;
    },
  };
}
