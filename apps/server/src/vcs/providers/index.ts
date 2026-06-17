import { type OauthCredential } from "../oauth-refresh.js";
import { type TokenCache } from "../token-cache.js";
import { type ConnectionKind, type VcsConnection, type VcsProvider } from "../types.js";

import { createGithubAppProvider, type OctokitFactory } from "./github-app.js";
import { createManualProvider } from "./manual.js";
import { createOauthProvider, type OauthTokenOctokitFactory } from "./oauth.js";

// Registry/dispatcher: pick the VcsProvider for a connection kind
// (26-vcs-connections.md). The connections service builds the dep bundle once
// (a shared token cache so App tokens cache across requests) and dispatches per
// connection.
export interface ProviderDeps {
  /** App-installation-authed Octokit factory (github_app) */
  octokitFor: OctokitFactory;
  readSecret: (ref: string) => Promise<string>;
  /** user-token-authed Octokit factory (oauth) */
  oauthOctokitForToken: OauthTokenOctokitFactory;
  /** exchange an oauth refresh token (per connection — provider selects the endpoint) */
  oauthRefresh: (conn: VcsConnection, refreshToken: string) => Promise<OauthCredential>;
  /** persist a rotated oauth credential (re-seal + update token_expires_at) */
  oauthPersist: (conn: VcsConnection, cred: OauthCredential) => Promise<void>;
  /** shared across github_app provider instances so installation tokens cache */
  cache?: TokenCache;
}

export function providerFor(kind: ConnectionKind, deps: ProviderDeps): VcsProvider {
  switch (kind) {
    case "github_app":
      return createGithubAppProvider({
        octokitFor: deps.octokitFor,
        ...(deps.cache ? { cache: deps.cache } : {}),
      });
    case "oauth":
      return createOauthProvider({
        readSecret: deps.readSecret,
        octokitForToken: deps.oauthOctokitForToken,
        refresh: deps.oauthRefresh,
        persist: deps.oauthPersist,
      });
    case "manual":
      return createManualProvider({ readSecret: deps.readSecret });
  }
}
