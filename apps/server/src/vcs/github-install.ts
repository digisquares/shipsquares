// GitHub App install URL (26-vcs-connections.md). The browser is redirected
// here to install the ShipSquares App on an org/repos; GitHub then calls our
// callback with installation_id + the signed state. Pure.

export function githubInstallUrl(appSlug: string, state: string): string {
  return `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new?state=${encodeURIComponent(state)}`;
}
