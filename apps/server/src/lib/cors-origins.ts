import { type Env } from "@ss/shared";

// Allowed browser origins for credentialed CORS + better-auth trust. The
// bundled SPA is same-origin and needs no CORS at all; the allowlist is the
// AUTH_URL origin, any AUTH_TRUSTED_ORIGINS extras (self-hosted reality: the
// dashboard is reached by server IP and domain and SSH tunnel at once — the
// Coolify/Dokploy model), plus the Vite dev server in development. Always
// explicit entries, never reflection.
export function corsOrigins(
  config: Pick<Env, "AUTH_URL" | "NODE_ENV"> & { AUTH_TRUSTED_ORIGINS?: string | undefined },
): string[] {
  const origins = new Set<string>();
  const add = (raw: string): void => {
    try {
      origins.add(new URL(raw).origin);
    } catch {
      // malformed entry — dropped rather than widening the allowlist
    }
  };
  add(config.AUTH_URL);
  for (const extra of (config.AUTH_TRUSTED_ORIGINS ?? "").split(",")) {
    if (extra.trim()) add(extra.trim());
  }
  if (config.NODE_ENV === "development") {
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
  }
  return [...origins];
}

/** The request's own base URL, from the real Host header + the edge proxy's
 *  x-forwarded-proto (falling back to the socket protocol, then AUTH_URL).
 *  The auth bridge builds better-auth's Request from this — NOT from
 *  AUTH_URL — so better-auth sees the host the browser actually used. */
export function requestBaseUrl(
  headers: Record<string, string | string[] | undefined>,
  socketProtocol: string,
  authUrl: string,
): string {
  const forwarded = headers["x-forwarded-proto"];
  const proto =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim() || socketProtocol;
  const host = typeof headers.host === "string" ? headers.host : undefined;
  if (host) return `${proto}://${host}`;
  try {
    return new URL(authUrl).origin;
  } catch {
    return authUrl;
  }
}

/** better-auth trustedOrigins, per request: the explicit allowlist PLUS the
 *  request's own origin. The SPA is served by this same process, so
 *  same-origin login works at ANY host that reaches the server — server IP,
 *  domain, SSH tunnel — with zero configuration (the Coolify/Dokploy model).
 *  CSRF safety holds: a cross-site attacker page sends ITS OWN origin, which
 *  never equals the host being served; cross-origin callers stay
 *  allowlist-only. */
export function trustedOriginsFor(
  config: Pick<Env, "AUTH_URL" | "NODE_ENV"> & { AUTH_TRUSTED_ORIGINS?: string | undefined },
): (request?: Request) => string[] {
  return (request) => {
    const origins = new Set(corsOrigins(config));
    try {
      if (request) origins.add(new URL(request.url).origin);
    } catch {
      // no parseable request URL — the static allowlist still applies
    }
    return [...origins];
  };
}
