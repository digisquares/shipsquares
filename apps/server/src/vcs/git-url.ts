// Pure git-URL + credential-shape helpers for the manual provider
// (26-vcs-connections.md).

const PEM_PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/;

/** Heuristic: is the stored secret an SSH deploy key (PEM) vs a token/PAT? */
export function looksLikeSshKey(secret: string): boolean {
  return PEM_PRIVATE_KEY.test(secret);
}

/** `https://host/owner/repo.git` → scp-style `git@host:owner/repo.git`. */
export function httpsToSsh(httpsUrl: string): string {
  const u = new URL(httpsUrl);
  const path = u.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  return `git@${u.host}:${path}`;
}
