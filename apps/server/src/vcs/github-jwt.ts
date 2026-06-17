import { createSign } from "node:crypto";

// GitHub App JWT minting (26-vcs-connections.md). Faithful to Coolify
// app/Models/GithubApp.php generateGithubJwt and Dokploy
// utils/providers/github.ts (authGithub): an RS256 JWT signed with the App's
// private key, `iat` backdated 60s for clock skew, `exp` +10min, `iss` = app id.
// This JWT is then exchanged at GitHub for a short-lived installation token
// (the exchange is the runtime/network step). Pure.

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export interface AppJwtClaims {
  iat: number;
  exp: number;
  iss: string;
}

export function generateAppJwt(appId: string, privateKeyPem: string, nowSeconds: number): string {
  const header = { alg: "RS256", typ: "JWT" };
  const payload: AppJwtClaims = { iat: nowSeconds - 60, exp: nowSeconds + 600, iss: appId };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKeyPem);
  return `${signingInput}.${b64url(signature)}`;
}

/** Decode a JWT's claims (no verification) — for inspection/tests. */
export function decodeJwtClaims(jwt: string): AppJwtClaims {
  const part = jwt.split(".")[1];
  if (!part) throw new Error("malformed jwt");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as AppJwtClaims;
}
