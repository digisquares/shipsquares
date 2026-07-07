import { lookup } from "node:dns/promises";

import { ValidationError } from "@ss/shared";

// SSRF guard (19-security): notification channels + outbound webhooks make the
// control plane POST user-supplied URLs — without this, loopback/private targets
// (incl. the Caddy admin API on 127.0.0.1:2019, which accepts config POSTs) are
// reachable by any app:write holder. `assertPublicUrl` rejects non-http(s)
// schemes and literal loopback/private/link-local hosts. `assertPublicUrlResolved`
// (S4) additionally resolves the hostname and re-checks every A/AAAA — the
// DNS-rebinding defence — and is called right before each outbound request.

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true; // 0/8, 10/8, loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::" || h === "::1") return true; // unspecified / loopback
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // ULA fc00::/7
  if (/^fe[89ab]/.test(h)) return true; // link-local fe80::/10
  if (h.startsWith("::ffff:")) {
    // v4-mapped — URL normalizes to hex groups (::ffff:7f00:1), dotted also possible
    const rest = h.slice(7);
    if (rest.includes(".")) return isPrivateIpv4(rest);
    const groups = rest.split(":");
    if (groups.length === 2) {
      const hi = parseInt(groups[0]!, 16);
      const lo = parseInt(groups[1]!, 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        return isPrivateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
    }
  }
  return false;
}

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  return isPrivateIpv4(h) || isPrivateIpv6(h);
}

/** Parse + validate an outbound URL; throws a 400 ValidationError otherwise. */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("only http(s) URLs are allowed");
  }
  if (isPrivateHost(url.hostname)) {
    throw new ValidationError("URL host resolves to a private or loopback address");
  }
  return url;
}

/** Injected DNS resolver → the list of addresses a host resolves to. */
export type Resolver = (host: string) => Promise<string[]>;

// OS resolver (getaddrinfo): what the actual connection will use, so it honours
// /etc/hosts and A/AAAA the same way `fetch` does.
async function defaultResolve(host: string): Promise<string[]> {
  const addrs = await lookup(host, { all: true });
  return addrs.map((a) => a.address);
}

/**
 * Like {@link assertPublicUrl}, but ALSO resolves the hostname and rejects if ANY
 * resolved address is private/loopback/link-local (S4 — the DNS-rebinding defence
 * the sync guard lacked). Call this immediately before an outbound request so the
 * address about to be dialled is the one that was validated. A host that fails to
 * resolve right now defers to the real request (which fails with a clear error);
 * IP-literal hosts skip the lookup (already covered by the literal check). The
 * resolver is injectable for tests. Residual: for full pinning, hand the same
 * validated address to the request's connector (custom undici lookup).
 */
export async function assertPublicUrlResolved(
  raw: string,
  resolve: Resolver = defaultResolve,
): Promise<URL> {
  const url = assertPublicUrl(raw); // scheme + literal-host checks first
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
  if (isIpLiteral) return url;
  let ips: string[];
  try {
    ips = await resolve(url.hostname);
  } catch {
    return url; // unresolvable now — let the real request fail with a clear error
  }
  for (const ip of ips) {
    if (isPrivateHost(ip)) {
      throw new ValidationError(`URL host resolves to a private or loopback address (${ip})`);
    }
  }
  return url;
}
