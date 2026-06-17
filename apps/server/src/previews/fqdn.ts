// Preview / PR environment helpers (31-preview-environments.md). Each PR gets a
// deterministic wildcard host and a per-app concurrency limit. Pure.

export function previewFqdn(prNumber: number, appName: string, wildcardDomain: string): string {
  return `pr-${prNumber}-${appName}.${wildcardDomain}`;
}

/** A `-pr-<n>` suffix isolates the project/container/network/volume names. */
export function previewSuffix(prNumber: number): string {
  return `-pr-${prNumber}`;
}

export function previewLimitReached(activeCount: number, limit: number): boolean {
  return limit > 0 && activeCount >= limit;
}
