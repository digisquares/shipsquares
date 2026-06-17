// The permission catalog — `resource:action` strings checked by requirePermission.
// API keys carry a subset of these as scopes (05-auth-rbac.md).
export const PERMISSIONS = [
  "org:read",
  "org:write",
  "org:delete",
  "member:read",
  "member:write",
  "server:read",
  "server:write",
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
  "apikey:read",
  "apikey:write",
  "webhook:read",
  "webhook:write",
  "audit:read",
  // Database Studio (database-studio/04-security-rbac-safety.md): browse/read,
  // edit/write data, and manage external connection profiles (credentials).
  "dbstudio:read",
  "dbstudio:write",
  "dbstudio:connect",
  // Managed email (R9 · mail/04-security-rbac-deliverability.md): view mail
  // state, manage domains/mailboxes/aliases, and admin the instance/DNS-provider
  // creds/relay. mail:admin is owner/admin only (same trust as managing secrets).
  "mail:read",
  "mail:write",
  "mail:admin",
  // Update notifications (auto-update.md): read the current/latest version state
  // (any member), and trigger an on-demand re-check / future apply (owner/admin).
  "update:read",
  "update:write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
