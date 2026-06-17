// Image retention for rollback (07-docker-builders.md, 06-deploy-engine.md): keep
// the newest N tags per app plus the current rollback target, prune the rest.
// Never touches other apps'/accessories' images.

export interface ImageTag {
  tag: string; // e.g. "myapp:9f2c1ab"
  createdAt: number; // epoch ms (newest-first ordering)
}

export function selectImagesToPrune(
  tags: ImageTag[],
  keep: number,
  rollbackTag?: string,
): string[] {
  const sorted = [...tags].sort((a, b) => b.createdAt - a.createdAt);
  const kept = new Set(sorted.slice(0, Math.max(0, keep)).map((t) => t.tag));
  if (rollbackTag) kept.add(rollbackTag);
  return sorted.filter((t) => !kept.has(t.tag)).map((t) => t.tag);
}
