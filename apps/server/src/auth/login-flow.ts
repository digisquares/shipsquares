import type { Role } from "../lib/ctx.js";
import type { Permission } from "../rbac/permissions.js";
import { ROLE_MATRIX } from "../rbac/roles.js";

// Server-driven device Login Flow (docs/mobile/01-architecture.md). A native app
// opens `${baseUrl}/login/flow?redirect=ss://login` in an in-app browser, the user
// authenticates with the control plane's OWN login (password · 2FA · SSO · passkey),
// then a consent step mints a device-scoped, revocable token and hands it back over
// the deep link. The token is a normal API key (ss_live_…), so it lists + revokes
// alongside the others; this module is just the policy around minting one.

/** The app's registered return scheme. The only redirect we'll ever hand a token to. */
export const DEFAULT_DEVICE_REDIRECT = "ss://login";

/**
 * A redirect is only acceptable if it targets the app's custom scheme exactly
 * (`ss://login`) — never an http(s) origin or another host. This is the boundary that
 * stops a token from being handed to an attacker-controlled URL.
 */
export function isAllowedDeviceRedirect(redirect: string): boolean {
  try {
    const u = new URL(redirect);
    return u.protocol === "ss:" && u.hostname === "login";
  } catch {
    return false;
  }
}

/**
 * Scopes for a device token: the DEPLOYER permission set intersected with the
 * signing-in user's own role. So a viewer's phone stays read-only (no escalation),
 * an owner/admin's phone gets the full deployer surface (a deliberate cap — API keys
 * never administer the org), and a deployer gets exactly their role.
 */
export function deviceLoginScopes(role: Role): Permission[] {
  const mine = ROLE_MATRIX[role];
  return [...ROLE_MATRIX.deployer].filter((perm) => mine.has(perm));
}

/** A friendly, revocation-legible default name for the minted key. */
export function deviceTokenName(input?: string): string {
  const trimmed = input?.trim();
  return trimmed ? trimmed.slice(0, 120) : "Mobile (Login Flow)";
}
