import { createHash, randomBytes } from "node:crypto";

// API-key token core (05-auth-rbac.md): `ss_live_<48 hex>` bearer tokens.
// Only the sha256 hash is stored — the token is shown exactly once at create.
// The prefix lets parseBearer reject foreign Authorization headers cheaply
// (session requests, basic auth) before any DB lookup.

const PREFIX = "ss_live_";
const TOKEN_RE = /^ss_live_[0-9a-f]{48}$/;

export function generateApiKey(): { token: string; hash: string } {
  const token = `${PREFIX}${randomBytes(24).toString("hex")}`;
  return { token, hash: hashApiKey(token) };
}

export function hashApiKey(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function parseBearer(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const [scheme, value] = authorization.split(/\s+/, 2);
  if (!scheme || scheme.toLowerCase() !== "bearer" || !value) return null;
  return TOKEN_RE.test(value) ? value : null;
}
