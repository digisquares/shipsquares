import { type BranchRef, type RepoRef } from "./types.js";

// Map a GitHub repository API object to our provider-neutral RepoRef
// (26-vcs-connections.md, listRepos). Pure; the paginated fetch lives in the
// Octokit-backed provider.

export interface GithubRepo {
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch?: string;
  private?: boolean;
  clone_url: string;
}

export function toRepoRef(r: GithubRepo): RepoRef {
  return {
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    defaultBranch: r.default_branch ?? "main",
    private: r.private ?? false,
    cloneUrl: r.clone_url,
  };
}

export interface GithubBranch {
  name: string;
  commit: { sha: string };
  protected?: boolean;
}

export function toBranchRef(b: GithubBranch): BranchRef {
  return { name: b.name, commit: b.commit.sha, protected: b.protected ?? false };
}

// Derive a RepoRef from an app's stored https git URL + branch (06.fetch handoff,
// when we don't have the provider's repo object). Owner is everything before the
// final path segment (handles GitLab group/subgroup).
/** repoRefFromUrl without the throw: scp-style ssh remotes ("git@host:o/r.git")
 *  and other non-URL strings return null so callers can fall back to the plain
 *  clone URL instead of failing the deploy with "Invalid URL". */
export function safeRepoRefFromUrl(url: string, branch: string): RepoRef | null {
  try {
    return repoRefFromUrl(url, branch);
  } catch {
    return null;
  }
}

export function repoRefFromUrl(httpsUrl: string, branch: string): RepoRef {
  const u = new URL(httpsUrl);
  const path = u.pathname
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  const segments = path.split("/");
  const name = segments.pop() ?? "";
  const owner = segments.join("/");
  return {
    owner,
    name,
    fullName: owner ? `${owner}/${name}` : name,
    defaultBranch: branch,
    private: true,
    cloneUrl: httpsUrl,
  };
}
