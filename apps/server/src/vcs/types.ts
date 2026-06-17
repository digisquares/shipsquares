// VCS connection types + the kind-agnostic provider port (26-vcs-connections.md).
// DB enums are the source of truth (db/schema/enums.ts: vcsProvider, vcsKind);
// these mirror them for the service/provider layer.

export type Provider = "github" | "gitlab" | "gitea" | "bitbucket" | "generic";
export type ConnectionKind = "github_app" | "oauth" | "manual";

// A connection is a credential + an account, not a repo: "org X can act as
// account <login> on <provider> via <kind>". Apps bind to one via
// apps.vcs_connection_id.
export interface VcsConnection {
  id: string;
  organizationId: string;
  provider: Provider;
  kind: ConnectionKind;
  accountLogin: string;
  installationId: string | null;
  githubAppId: string | null;
  /** pointer into the secret store (11) — never the plaintext credential */
  tokenSecretRef: string | null;
  /** manifest Apps: the registration whose sealed key this connection uses
   *  (instead of a per-connection tokenSecretRef copy) — R2.7 */
  appRegistrationId?: string | null;
  /** oauth: access-token expiry (epoch ms) for refresh-before-expiry; null/absent otherwise */
  tokenExpiresAt?: number | null;
}

export interface RepoRef {
  owner: string;
  name: string;
  /** owner/name */
  fullName: string;
  defaultBranch: string;
  private: boolean;
  /** https url, no creds embedded */
  cloneUrl: string;
}

export interface BranchRef {
  name: string;
  /** head commit sha */
  commit: string;
  protected: boolean;
}

export type CloneCredential =
  | { scheme: "https-token"; url: string; token: string } // app / oauth / manual-PAT
  | { scheme: "ssh-key"; url: string; keyRef: string }; // manual deploy key

export interface WebhookSpec {
  /** https://<control>/hooks/<provider>/<webhookId> */
  ingestUrl: string;
  /** generated; stored as a ref in 11, verified by 10 */
  secret: string;
  events: ["push"];
}

// The provider's remote-registration result. Our inbound_webhooks id is bound by
// the service layer (10), not the provider.
export interface RegisteredWebhook {
  /** provider hook id; null for manual (user pastes) */
  remoteId: string | null;
  /** true => show url+secret to paste */
  manual: boolean;
}

/** One port, three implementations (github_app | oauth | manual). */
export interface VcsProvider {
  readonly kind: ConnectionKind;
  listRepos(conn: VcsConnection): Promise<RepoRef[]>;
  /** List a repo's branches (optional — github_app implements it; the repo+branch
   *  picker degrades to the default branch when a kind doesn't support it). */
  listBranches?(conn: VcsConnection, owner: string, repo: string): Promise<BranchRef[]>;
  /** fresh, valid-for-the-whole-clone credential (mints an App token on demand) */
  getCloneCredential(conn: VcsConnection, repo: RepoRef): Promise<CloneCredential>;
  registerWebhook(
    conn: VcsConnection,
    repo: RepoRef,
    spec: WebhookSpec,
  ): Promise<RegisteredWebhook>;
  removeWebhook(conn: VcsConnection, repo: RepoRef, remoteId: string): Promise<void>;
}
