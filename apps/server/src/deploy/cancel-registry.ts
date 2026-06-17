// In-flight deploy cancellation (ROADMAP gap-fill: cancel a RUNNING deploy).
// The executor registers an AbortController per deployment id while it runs;
// cancelDeployment aborts it, which SIGKILLs the current child and lets the
// pipeline finalize as cancelled. Process-local — a deploy running on another
// control-plane instance can't be aborted from here (a multi-instance follow-up
// would route the abort over the pg bus); the single-process case is the norm.

const controllers = new Map<string, AbortController>();

/** Begin tracking a running deploy; returns its AbortController (signal goes
 *  into runCommand). Replaces any stale entry for the same id. */
export function registerDeploy(deploymentId: string): AbortController {
  const ac = new AbortController();
  controllers.set(deploymentId, ac);
  return ac;
}

/** Request cancellation. True if the deploy was tracked here (and now aborting). */
export function abortDeploy(deploymentId: string): boolean {
  const ac = controllers.get(deploymentId);
  if (!ac) return false;
  ac.abort();
  return true;
}

export function isCancelRequested(deploymentId: string): boolean {
  return controllers.get(deploymentId)?.signal.aborted ?? false;
}

export function clearDeploy(deploymentId: string): void {
  controllers.delete(deploymentId);
}
