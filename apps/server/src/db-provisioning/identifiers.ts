// SQL identifier safety for DB provisioning (24-database-servers.md, 19-security).
// Database/role names come from users, so they are strictly validated and quoted
// before ever being interpolated into a CREATE DATABASE / CREATE ROLE statement —
// an injection attempt via a name is rejected, never executed.

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export function isValidIdentifier(name: string): boolean {
  return IDENTIFIER.test(name);
}

export function assertIdentifier(name: string): void {
  if (!isValidIdentifier(name)) {
    throw new Error(`invalid SQL identifier: ${JSON.stringify(name)}`);
  }
}

/** Returns a safely double-quoted identifier, or throws if the name is unsafe. */
export function quoteIdentifier(name: string): string {
  assertIdentifier(name);
  return `"${name}"`;
}
