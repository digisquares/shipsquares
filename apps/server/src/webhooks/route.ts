import micromatch from "micromatch";

// Route a normalized VcsEvent to apps (10-webhooks-vcs.md). The DB query
// (provider+repo+owner+branch+autoDeploy) is runtime; the filtering applied to
// the candidate apps — watchPaths + [skip ci] — is pure.

const SKIP_KEYWORDS = ["[skip ci]", "[ci skip]", "[no ci]", "[skip deploy]"];

export function hasSkipKeyword(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return SKIP_KEYWORDS.some((k) => m.includes(k));
}

// Faithful port of Dokploy utils/watch-paths/should-deploy.ts:3-12 (Apache-2.0):
// no watchPaths → always deploy; else micromatch.some(changedFiles, watchPaths).
export function matchesWatchPaths(
  watchPaths: string[] | null | undefined,
  changedPaths: string[],
): boolean {
  if (!watchPaths || watchPaths.length === 0) return true;
  const files = changedPaths.filter((f): f is string => typeof f === "string");
  return micromatch.some(files, watchPaths);
}

export interface RoutableApp {
  id: string;
  watchPaths?: string[] | null;
}

export function filterRoutableApps(
  apps: RoutableApp[],
  event: { changedPaths: string[]; commitMessage?: string },
): RoutableApp[] {
  if (hasSkipKeyword(event.commitMessage)) return [];
  return apps.filter((a) => matchesWatchPaths(a.watchPaths, event.changedPaths));
}

/** Poll change-detection (port of Portainer RedeployWhenChanged): deploy when the
 *  remote tip advances past the last polled commit. */
export function pollChanged(remoteTip: string, lastPolled: string | null | undefined): boolean {
  return remoteTip.length > 0 && remoteTip !== (lastPolled ?? "");
}
