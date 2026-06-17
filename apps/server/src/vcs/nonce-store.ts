// One-time nonce store for the GitHub-App install state: a signed state
// was replayable for its whole validity window — revisiting the callback URL (or
// a leaked state) re-created connections. In-process like the token cache: the
// control plane is a single process (18-installer-ops).

export interface NonceStore {
  /** true the first time a nonce is seen; false on any replay within the TTL. */
  consume(nonce: string, now: number): boolean;
  size(): number;
}

const DEFAULT_TTL_MS = 15 * 60_000; // outlives the install-state expiry
const MAX_ENTRIES = 10_000; // backstop — install flows are low-volume

export function createNonceStore(ttlMs: number = DEFAULT_TTL_MS): NonceStore {
  const seen = new Map<string, number>(); // nonce → expiry epoch-ms

  const sweep = (now: number): void => {
    for (const [nonce, expires] of seen) {
      if (expires <= now) seen.delete(nonce);
    }
  };

  return {
    consume(nonce, now) {
      sweep(now);
      if (seen.has(nonce)) return false;
      if (seen.size >= MAX_ENTRIES) seen.clear(); // fail open, bounded memory
      seen.set(nonce, now + ttlMs);
      return true;
    },
    size: () => seen.size,
  };
}
