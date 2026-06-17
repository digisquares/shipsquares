// Pure display helpers for the org settings cards (members + API keys).

export function memberLabel(m: { name: string | null; email: string | null; userId: string }) {
  return m.name ?? m.email ?? m.userId;
}

/** An empty scope list means the key inherits its creator's full role. */
export function scopesLabel(scopes: string[]): string {
  return scopes.length ? scopes.join(", ") : "full role access";
}

export const ORG_ROLES = ["owner", "admin", "deployer", "viewer"] as const;
