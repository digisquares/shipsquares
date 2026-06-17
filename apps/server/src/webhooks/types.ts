// Inbound VCS webhook contracts (10-webhooks-vcs.md). Every provider's payload is
// normalized to one VcsEvent so routing/enqueue is provider-agnostic.

export type Provider = "github" | "gitlab" | "gitea" | "bitbucket";
export type VcsEventKind = "push" | "tag" | "pull_request" | "ping";

export interface VcsEvent {
  provider: Provider;
  kind: VcsEventKind;
  repo: string; // repository name
  owner: string; // owner / namespace
  branch: string | null; // null for tag/ping
  tag: string | null;
  commit: string | null; // head sha after push
  commitMessage: string;
  changedPaths: string[]; // for watchPaths filtering
  deliveryId: string; // provider delivery id -> idempotency key
}
