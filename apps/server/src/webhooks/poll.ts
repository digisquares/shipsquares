// Git-poll fallback cores (ROADMAP R2.1): when webhooks can't reach the box
// (NAT, strict firewalls), an opt-in poll compares the remote head to the
// last deployed commit. Pure; the service binds git ls-remote + the deploy
// dispatch.

const SHA_LINE = /^([0-9a-f]{4,40})\t(.+)$/;

/** `git ls-remote <url> refs/heads/<branch> HEAD` output → the sha to track:
 *  the branch ref when present, HEAD otherwise, null when unreadable. */
export function parseLsRemoteHead(output: string, branch: string): string | null {
  let head: string | null = null;
  for (const line of output.split("\n")) {
    const m = SHA_LINE.exec(line.trim());
    if (!m) continue;
    if (m[2] === `refs/heads/${branch}`) return m[1]!;
    if (m[2] === "HEAD") head = m[1]!;
  }
  return head;
}

export function pollDecision(input: {
  remoteHead: string | null;
  lastDeployedCommit: string | null;
}): "deploy" | "skip" {
  if (!input.remoteHead) return "skip";
  if (input.lastDeployedCommit === input.remoteHead) return "skip";
  return "deploy";
}
