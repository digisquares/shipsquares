import { AppError } from "@ss/shared";

// SSRF / egress guard for EXTERNAL connection profiles
// (database-studio/04-security-rbac-safety.md). An external host could point the
// control plane at loopback, the cloud metadata endpoint, or a private service.
// The literal checks are pure (unit-tested); assertHostAllowed additionally
// resolves the host and re-checks the IP (DNS-rebinding defence) when a resolver
// is injected. Managed/control-plane hosts bypass this (platform-controlled).

/** Returns a block reason for an IP literal, or null if allowed. */
export function ipBlocked(ip: string): string | null {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1).map((n) => Number(n));
    if (o.some((n) => n > 255)) return "invalid IPv4 address";
    const [a, b] = o as [number, number, number, number];
    if (a === 0) return "unspecified address blocked";
    if (a === 127) return "loopback address blocked";
    if (a === 10) return "private address blocked";
    if (a === 172 && b >= 16 && b <= 31) return "private address blocked";
    if (a === 192 && b === 168) return "private address blocked";
    if (a === 169 && b === 254) return "link-local / metadata address blocked";
    if (a === 100 && b >= 64 && b <= 127) return "carrier-grade NAT address blocked";
    if (a >= 224) return "multicast / reserved address blocked";
    return null;
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v6 === "::1") return "loopback address blocked";
  if (v6 === "::") return "unspecified address blocked";
  if (v6.startsWith("fe80")) return "link-local address blocked";
  if (v6.startsWith("fc") || v6.startsWith("fd")) return "unique-local address blocked";
  const mapped = v6.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return ipBlocked(mapped[1]!);
  return null;
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "metadata.google.internal"]);

/** Returns a block reason for a host literal, or null if allowed. */
export function hostLiteralBlocked(host: string): string | null {
  const h = host.trim().toLowerCase();
  if (!h) return "empty host";
  if (BLOCKED_HOSTNAMES.has(h)) return `host ${host} is not allowed`;
  if (h.endsWith(".internal") || h.endsWith(".local") || h.endsWith(".localhost")) {
    return `host ${host} is not allowed`;
  }
  const bare = h.replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare) || bare.includes(":")) {
    const r = ipBlocked(bare);
    if (r) return r;
  }
  return null;
}

export interface SsrfOptions {
  /** Operator opt-in to permit private/internal targets (self-hosted DBs). */
  allowPrivate?: boolean;
  /** Injected DNS resolver; when present, resolved IPs are re-checked. */
  resolve?: (host: string) => Promise<string[]>;
}

export async function assertHostAllowed(host: string, opts: SsrfOptions = {}): Promise<void> {
  if (opts.allowPrivate) return;
  const literal = hostLiteralBlocked(host);
  if (literal) throw new AppError(literal, { status: 400, code: "dbstudio.host_blocked" });
  if (opts.resolve) {
    let ips: string[] = [];
    try {
      ips = await opts.resolve(host);
    } catch {
      // Unresolvable now — let the real connect attempt fail later with a clear error.
      return;
    }
    for (const ip of ips) {
      const r = ipBlocked(ip);
      if (r) {
        throw new AppError(`${host} resolves to a blocked address (${r})`, {
          status: 400,
          code: "dbstudio.host_blocked",
        });
      }
    }
  }
}
