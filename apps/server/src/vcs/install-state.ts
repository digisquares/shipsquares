import { createHmac, timingSafeEqual } from "node:crypto";

// GitHub App install CSRF state (26-vcs-connections.md). The install redirect
// carries a signed `state = "<body>.<sig>"` binding the flow to an org + nonce +
// timestamp; the callback verifies it so a connection can't be bound to the
// wrong org (CSRF) or replayed after it expires. Pure (HMAC-SHA256).

export interface InstallStatePayload {
  orgId: string;
  nonce: string;
  /** epoch ms when signed */
  ts: number;
  /** Which signed flow this state belongs to; callbacks check it so a manifest
   *  state can't be replayed at the install callback or vice-versa. */
  action?: "install" | "manifest";
  /** The app registration being installed (manifest Apps) — the callback uses
   *  THIS registration's key (correct for orgs with multiple Apps) and links the
   *  connection to it. Absent → env-configured shared App. */
  regId?: string;
}

const DEFAULT_MAX_AGE_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 60_000;

const encode = (s: string): string => Buffer.from(s, "utf8").toString("base64url");
const decode = (s: string): string => Buffer.from(s, "base64url").toString("utf8");

export function signInstallState(payload: InstallStatePayload, secret: string): string {
  const body = encode(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

// Returns the payload when authentic and unexpired, else null (tampered, wrong
// secret, malformed, expired, or implausibly future-dated).
export function verifyInstallState(
  state: string,
  secret: string,
  now: number,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): InstallStatePayload | null {
  const dot = state.indexOf(".");
  if (dot <= 0 || dot === state.length - 1) return null;
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: InstallStatePayload;
  try {
    payload = JSON.parse(decode(body)) as InstallStatePayload;
  } catch {
    return null;
  }
  if (
    typeof payload?.orgId !== "string" ||
    typeof payload?.nonce !== "string" ||
    typeof payload?.ts !== "number"
  ) {
    return null;
  }
  if (now - payload.ts > maxAgeMs || payload.ts - now > CLOCK_SKEW_MS) return null;
  return payload;
}
