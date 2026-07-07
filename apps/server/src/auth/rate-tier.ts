// Per-path rate-limit tier for the better-auth handler (S5). The global limiter
// (plugins/security.ts) is a coarse 1000/min/IP meant to protect the control
// plane, not to resist credential brute-force. The auth handler mounts every
// better-auth endpoint under one wildcard route, so we vary `max` by sub-path:
// credential-submitting endpoints (sign-in, sign-up, 2FA, password reset) get a
// tight per-IP budget; high-frequency reads like /auth/get-session keep the
// generous default so normal session polling (window focus/visibility) is
// unaffected.

// Sensitive endpoints, matched on the path AFTER the /auth base. Kept as
// fragments so a better-auth version that renames a leaf (e.g. verify-totp →
// verify) still matches the family.
const SENSITIVE = [
  "sign-in",
  "sign-up",
  "two-factor",
  "forget-password",
  "reset-password",
  "verify-email",
  "change-password",
  "change-email",
];

/** Attempts/minute/IP allowed for a credential-submitting auth endpoint. */
export const AUTH_SENSITIVE_MAX = 10;

/**
 * Max requests/minute for an /auth/* URL. Returns the tight budget for a
 * credential path, else `defaultMax` (the global tier) so reads aren't throttled.
 * Pure + case-insensitive; ignores the querystring.
 */
export function authRateMax(url: string, defaultMax: number): number {
  const path = url.split("?", 1)[0]!.toLowerCase();
  return SENSITIVE.some((frag) => path.includes(frag)) ? AUTH_SENSITIVE_MAX : defaultMax;
}
