import type { Provider, VcsEvent, VcsEventKind } from "./types.js";

// Per-provider payload normalization, ported from Dokploy (Apache-2.0):
// apps/dokploy/pages/api/deploy/[refreshToken].ts — extractBranchName (:519-536),
// extractHash (:483-517), extractCommitMessage (:428-481), changed paths
// (commits[].modified, :122-124) — and github.ts (:217-225) for repo/owner. We
// additionally include added/removed paths (Dokploy reads only `.modified`).
// Defensive: payloads vary by version, so every access tolerates a missing value.

function obj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function collectChangedPaths(commits: unknown): string[] {
  const out = new Set<string>();
  for (const commit of arr(commits)) {
    const c = obj(commit);
    for (const field of ["modified", "added", "removed"]) {
      for (const path of arr(c[field])) {
        if (typeof path === "string") out.add(path);
      }
    }
  }
  return [...out];
}

function refToBranchTag(ref: string): { branch: string | null; tag: string | null } {
  if (ref.startsWith("refs/heads/")) return { branch: ref.slice("refs/heads/".length), tag: null };
  if (ref.startsWith("refs/tags/")) return { branch: null, tag: ref.slice("refs/tags/".length) };
  return { branch: null, tag: null };
}

export function parseGithub(
  body: unknown,
  deliveryId: string,
  kind: VcsEventKind = "push",
): VcsEvent {
  const b = obj(body);
  const repository = obj(b.repository);
  const owner = obj(repository.owner);
  const headCommit = obj(b.head_commit);
  const { branch, tag } = refToBranchTag(str(b.ref));
  return {
    provider: "github",
    kind,
    repo: str(repository.name),
    owner: str(owner.login) || str(owner.name), // push uses .name, PR uses .login (github.ts)
    branch,
    tag,
    commit: str(headCommit.id) || str(b.after) || null, // extractHash: body.head_commit.id
    commitMessage: str(headCommit.message),
    changedPaths: collectChangedPaths(b.commits),
    deliveryId,
  };
}

export function parseGitea(
  body: unknown,
  deliveryId: string,
  kind: VcsEventKind = "push",
): VcsEvent {
  const b = obj(body);
  const repository = obj(b.repository);
  const owner = obj(repository.owner);
  const { branch, tag } = refToBranchTag(str(b.ref));
  return {
    provider: "gitea",
    kind,
    repo: str(repository.name),
    owner: str(owner.username) || str(owner.login) || str(owner.name),
    branch,
    tag,
    commit: str(b.after) || null, // extractHash: body.after
    commitMessage: str(obj(arr(b.commits)[0]).message), // extractCommitMessage: commits[0].message
    changedPaths: collectChangedPaths(b.commits),
    deliveryId,
  };
}

export function parseGitlab(
  body: unknown,
  deliveryId: string,
  kind: VcsEventKind = "push",
): VcsEvent {
  const b = obj(body);
  const project = obj(b.project);
  const pathNs = str(project.path_with_namespace);
  const slash = pathNs.lastIndexOf("/");
  const { branch, tag } = refToBranchTag(str(b.ref));
  return {
    provider: "gitlab",
    kind,
    repo: slash >= 0 ? pathNs.slice(slash + 1) : str(project.name),
    owner: slash >= 0 ? pathNs.slice(0, slash) : "",
    branch,
    tag,
    commit: str(b.checkout_sha) || str(obj(arr(b.commits)[0]).id) || null, // checkout_sha, else commits[0].id
    commitMessage: str(obj(arr(b.commits)[0]).message),
    changedPaths: collectChangedPaths(b.commits),
    deliveryId,
  };
}

export function parseBitbucket(
  body: unknown,
  deliveryId: string,
  kind: VcsEventKind = "push",
): VcsEvent {
  const b = obj(body);
  const repository = obj(b.repository);
  const fullName = str(repository.full_name);
  const slash = fullName.indexOf("/");
  const change = obj(arr(obj(b.push).changes)[0]); // body.push.changes[0]
  const newRef = obj(change.new);
  const target = obj(newRef.target);
  const isTag = str(newRef.type) === "tag";
  return {
    provider: "bitbucket",
    kind,
    repo: slash >= 0 ? fullName.slice(slash + 1) : str(repository.name),
    owner: slash >= 0 ? fullName.slice(0, slash) : "",
    branch: isTag ? null : str(newRef.name) || null, // new.name (NOT a refs/heads strip)
    tag: isTag ? str(newRef.name) : null,
    commit: str(target.hash) || null, // push.changes[0].new.target.hash
    commitMessage: str(target.message),
    changedPaths: [], // bitbucket push has no file list; Dokploy fetches a diffstat via REST
    deliveryId,
  };
}

export function parseEvent(
  provider: Provider,
  body: unknown,
  deliveryId: string,
  kind: VcsEventKind = "push",
): VcsEvent {
  switch (provider) {
    case "github":
      return parseGithub(body, deliveryId, kind);
    case "gitea":
      return parseGitea(body, deliveryId, kind);
    case "gitlab":
      return parseGitlab(body, deliveryId, kind);
    case "bitbucket":
      return parseBitbucket(body, deliveryId, kind);
  }
}
