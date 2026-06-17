// PR-webhook routing for preview environments (31-preview-environments.md),
// adapted from Dokploy's pull_request handler + collaborator gate (Apache-2.0,
// see NOTICE + 35-reuse-map.md). Pure: payload parsing and the deploy/teardown
// decision; execution is the runtime orchestrator's job.

export interface PullRequestEvent {
  action: string;
  prNumber: number;
  headRef: string;
  headSha: string;
  /** head repo differs from base repo — code from outside the repo */
  isFork: boolean;
  title: string;
  labels: string[];
  authorAssociation: string;
}

interface PrPayloadShape {
  action?: unknown;
  number?: unknown;
  pull_request?: {
    head?: { ref?: unknown; sha?: unknown; repo?: { full_name?: unknown } };
    base?: { repo?: { full_name?: unknown } };
    title?: unknown;
    labels?: { name?: unknown }[];
    author_association?: unknown;
  };
}

export function parsePullRequestEvent(payload: unknown): PullRequestEvent | null {
  const p = payload as PrPayloadShape;
  const pr = p.pull_request;
  if (!pr || typeof p.action !== "string" || typeof p.number !== "number") return null;
  const headRepo = pr.head?.repo?.full_name;
  const baseRepo = pr.base?.repo?.full_name;
  return {
    action: p.action,
    prNumber: p.number,
    headRef: typeof pr.head?.ref === "string" ? pr.head.ref : "",
    headSha: typeof pr.head?.sha === "string" ? pr.head.sha : "",
    isFork: typeof headRepo === "string" && typeof baseRepo === "string" && headRepo !== baseRepo,
    title: typeof pr.title === "string" ? pr.title : "",
    labels: (pr.labels ?? [])
      .map((l) => (typeof l.name === "string" ? l.name : ""))
      .filter(Boolean),
    authorAssociation: typeof pr.author_association === "string" ? pr.author_association : "NONE",
  };
}

export interface PreviewSettings {
  enabled: boolean;
  /** previews only for PRs carrying this label (null = no label gate) */
  requireLabel: string | null;
  /** fork PRs must come from a trusted author (owner/member/collaborator) */
  trustedOnly: boolean;
  limitReached: boolean;
}

export interface PreviewDecision {
  action: "deploy" | "teardown" | "ignore";
  reason?: string;
}

const DEPLOY_ACTIONS = ["opened", "synchronize", "reopened", "labeled"] as const;
const TRUSTED_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"] as const;
const SKIP_MARKER = "[skip preview]";

export function previewActionFor(e: PullRequestEvent, settings: PreviewSettings): PreviewDecision {
  // Teardown first: a closed PR must always clean up, gates notwithstanding.
  if (e.action === "closed") return { action: "teardown" };
  if (!settings.enabled) return { action: "ignore", reason: "previews disabled" };
  if (!(DEPLOY_ACTIONS as readonly string[]).includes(e.action)) {
    return { action: "ignore", reason: `irrelevant action "${e.action}"` };
  }
  if (e.title.toLowerCase().includes(SKIP_MARKER)) {
    return { action: "ignore", reason: "skip marker in title" };
  }
  if (settings.requireLabel && !e.labels.includes(settings.requireLabel)) {
    return { action: "ignore", reason: `missing required label "${settings.requireLabel}"` };
  }
  if (
    settings.trustedOnly &&
    e.isFork &&
    !(TRUSTED_ASSOCIATIONS as readonly string[]).includes(e.authorAssociation)
  ) {
    return { action: "ignore", reason: "untrusted fork PR" };
  }
  if (settings.limitReached) return { action: "ignore", reason: "preview limit reached" };
  return { action: "deploy" };
}
