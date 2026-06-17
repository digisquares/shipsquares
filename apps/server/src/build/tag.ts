// Deterministic image tags (07-docker-builders.md). Every build tags
// <app>:<commitShort> (the rollback handle) and moves <app>:latest.

export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

export function imageTag(appName: string, commit: string): string {
  return `${appName}:${shortCommit(commit)}`;
}

export function latestTag(appName: string): string {
  return `${appName}:latest`;
}
