import { type Env } from "@ss/shared";

import type { Db } from "../db/index.js";
import { loadMasterKey, open, seal } from "../secrets/crypto.js";
import { type SealedValue } from "../secrets/types.js";
import { getAppRegistrationById, persistOauthCredential } from "../services/connections.service.js";

import { exchangeRefreshToken, oauthTokenUrl } from "./oauth-exchange.js";
import { type OauthCredential, serializeOauthCredential } from "./oauth-refresh.js";
import { normalizePrivateKey } from "./private-key.js";
import { defaultOctokitFor } from "./providers/github-app.js";
import { type ProviderDeps } from "./providers/index.js";
import { defaultOauthOctokitForToken } from "./providers/oauth.js";
import { createTokenCache } from "./token-cache.js";
import { type VcsConnection } from "./types.js";

// Build the VcsProvider dependency bundle from runtime config (26-vcs-connections.md).
// A `*_secret_ref` stores the sealed JSON (JSON.stringify(seal(...))); readSecret
// opens it with the master key (11-secrets-config.md). The token cache is shared
// across requests so GitHub App installation tokens cache. OAuth refresh follows
// Dokploy's provider flow (35-reuse-map.md): hosted token endpoint + client
// credentials from config; the rotated credential is re-sealed and written back
// (with token_expires_at) when a db handle is supplied.
const tokenCache = createTokenCache();
const KEY_VERSION = 1;

/** Seal a plaintext secret into a *_secret_ref (the sealed JSON), 11-secrets-config. */
export function sealSecretRef(plain: string, config: Env): string {
  return JSON.stringify(seal(plain, loadMasterKey(config.SHIPSQUARES_MASTER_KEY), KEY_VERSION));
}

/** Open a *_secret_ref sealed by {@link sealSecretRef} back to plaintext. */
export function openSecretRef(ref: string, config: Env): string {
  return open(JSON.parse(ref) as SealedValue, loadMasterKey(config.SHIPSQUARES_MASTER_KEY));
}

function oauthClientFor(
  config: Env,
  provider: string,
): { clientId: string; clientSecret: string } | null {
  if (provider === "github" && config.GITHUB_OAUTH_CLIENT_ID && config.GITHUB_OAUTH_CLIENT_SECRET) {
    return {
      clientId: config.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: config.GITHUB_OAUTH_CLIENT_SECRET,
    };
  }
  if (provider === "gitlab" && config.GITLAB_OAUTH_CLIENT_ID && config.GITLAB_OAUTH_CLIENT_SECRET) {
    return {
      clientId: config.GITLAB_OAUTH_CLIENT_ID,
      clientSecret: config.GITLAB_OAUTH_CLIENT_SECRET,
    };
  }
  return null;
}

export function buildProviderDeps(config: Env, db?: Db): ProviderDeps {
  const key = loadMasterKey(config.SHIPSQUARES_MASTER_KEY);
  const readSecret = (ref: string): Promise<string> =>
    Promise.resolve(open(JSON.parse(ref) as SealedValue, key));

  // R2.7: a manifest-App connection references the org's single sealed key in
  // vcs_app_registrations rather than carrying its own copy. Resolve + unwrap it.
  const registrationKey = async (registrationId: string): Promise<string> => {
    if (!db) throw new Error("registration key lookup requires a db handle");
    const reg = await getAppRegistrationById(db, registrationId);
    if (!reg) throw new Error(`vcs app registration ${registrationId} not found`);
    const creds = JSON.parse(openSecretRef(reg.credentialsSecretRef, config)) as {
      privateKey: string;
    };
    return normalizePrivateKey(creds.privateKey);
  };

  const oauthRefresh = async (
    conn: VcsConnection,
    refreshToken: string,
  ): Promise<OauthCredential> => {
    const tokenUrl = oauthTokenUrl(conn.provider);
    const client = oauthClientFor(config, conn.provider);
    if (!tokenUrl || !client) {
      throw new Error(
        `OAuth refresh is not configured for "${conn.provider}" — set the provider's OAUTH_CLIENT_ID/SECRET`,
      );
    }
    return exchangeRefreshToken({ tokenUrl, ...client }, refreshToken, fetch);
  };

  const oauthPersist = async (conn: VcsConnection, cred: OauthCredential): Promise<void> => {
    if (!db) return; // no handle here — the next refresh persists
    await persistOauthCredential(
      db,
      conn.id,
      sealSecretRef(serializeOauthCredential(cred), config),
      cred.expiresAt ?? null,
    );
  };

  return {
    readSecret,
    octokitFor: defaultOctokitFor({ readSecret, registrationKey }),
    oauthOctokitForToken: defaultOauthOctokitForToken,
    oauthRefresh,
    oauthPersist,
    cache: tokenCache,
  };
}
