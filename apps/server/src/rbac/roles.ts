import type { Role } from "../lib/ctx.js";

import { PERMISSIONS, type Permission } from "./permissions.js";

const ALL = PERMISSIONS as readonly Permission[];

// Four built-in, org-scoped roles → permission sets. Custom roles are deferred
// (05-auth-rbac.md). A key's effective set is ROLE_MATRIX[role] ∩ key.scopes.
export const ROLE_MATRIX: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(ALL),
  admin: new Set(ALL.filter((p) => p !== "org:delete")),
  deployer: new Set<Permission>([
    "org:read",
    "member:read",
    "server:read",
    "app:read",
    "app:write",
    "domain:read",
    "domain:write",
    "env:read",
    "secret:read",
    "env:write",
    "deployment:read",
    "deployment:write",
    "accessory:read",
    "accessory:write",
    "webhook:read",
    "audit:read",
    // Browse + edit data, but NOT manage credentialed external profiles
    // (dbstudio:connect is admin/owner only — same trust as managing secrets).
    "dbstudio:read",
    "dbstudio:write",
    // Manage mail domains/mailboxes/aliases, but NOT instance/DNS-provider/relay
    // admin (mail:admin is owner/admin only — same trust as dbstudio:connect).
    "mail:read",
    "mail:write",
    // See update-availability (triggering a re-check stays owner/admin).
    "update:read",
  ]),
  viewer: new Set<Permission>(ALL.filter((p) => p.endsWith(":read") && p !== "secret:read")),
};

export function roleGrants(role: Role, perm: Permission): boolean {
  return ROLE_MATRIX[role].has(perm);
}
