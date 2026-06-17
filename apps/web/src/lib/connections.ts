// VCS connection view model for the web UI (mirrors the server's
// VcsConnectionView; 26-vcs-connections.md). Pure label helpers are unit-tested.

export type Provider = "github" | "gitlab" | "gitea" | "bitbucket" | "generic";
export type ConnectionKind = "github_app" | "oauth" | "manual";

export interface VcsConnection {
  id: string;
  provider: Provider;
  kind: ConnectionKind;
  accountLogin: string;
  installationId: string | null;
  githubAppId: string | null;
  createdAt: string;
}

const PROVIDER_NAMES: Record<Provider, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
  bitbucket: "Bitbucket",
  generic: "Generic",
};

const KIND_LABELS: Record<ConnectionKind, string> = {
  github_app: "App",
  oauth: "OAuth",
  manual: "Manual",
};

export function providerName(p: Provider): string {
  return PROVIDER_NAMES[p] ?? p;
}

export function kindLabel(k: ConnectionKind): string {
  return KIND_LABELS[k] ?? k;
}

/** e.g. "GitHub App · acme" */
export function connectionLabel(c: {
  provider: Provider;
  kind: ConnectionKind;
  accountLogin: string;
}): string {
  return `${providerName(c.provider)} ${kindLabel(c.kind)} · ${c.accountLogin}`;
}

export interface RepoRef {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  cloneUrl: string;
}

/** Case-insensitive substring filter over a repo's full name. */
export function filterRepos(repos: RepoRef[], query: string): RepoRef[] {
  const q = query.trim().toLowerCase();
  return q === "" ? repos : repos.filter((r) => r.fullName.toLowerCase().includes(q));
}
