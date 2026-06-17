// VCS clone-URL + token-endpoint construction (26-vcs-connections.md). The
// installation-token exchange and clone are runtime; building the URLs is pure.

export function installationTokenUrl(installationId: string): string {
  return `https://api.github.com/app/installations/${installationId}/access_tokens`;
}

/**
 * Inject an installation/OAuth token into an https clone URL as the
 * `x-access-token` user (GitHub's documented token-clone form). The returned URL
 * carries the token, so callers must treat it as secret (redacted from logs, 11).
 */
export function cloneUrlWithToken(repoUrl: string, token: string): string {
  let url: URL;
  try {
    url = new URL(repoUrl);
  } catch {
    throw new Error("token clone requires an https repo url");
  }
  if (url.protocol !== "https:") throw new Error("token clone requires an https repo url");
  url.username = "x-access-token";
  url.password = token;
  return url.toString();
}
