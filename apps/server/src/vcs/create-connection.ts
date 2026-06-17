import { type CreateConnectionInput } from "../services/connections.service.js";

import { serializeOauthCredential } from "./oauth-refresh.js";
import { type Provider } from "./types.js";

// POST /vcs-connections body → service input. Clients send the PLAINTEXT
// credential; only the server can mint a valid tokenSecretRef (sealed under the
// master key), so accepting a client-supplied ref produced rows that crashed on
// first use. `github_app` is rejected here — those connections are created only
// by the install callback. Pure: sealing is injected.

export interface CreateOauthBody {
  kind: "oauth";
  provider: Provider;
  accountLogin: string;
  /** plaintext access token / PAT — sealed server-side, never stored raw */
  token: string;
  refreshToken?: string;
  /** ISO timestamp of access-token expiry (refresh-capable providers) */
  expiresAt?: string;
}

export interface CreateManualBody {
  kind: "manual";
  provider: Provider;
  accountLogin: string;
  /** plaintext token or SSH private key (shape-detected at use) */
  credential: string;
}

export type CreateConnectionBody = CreateOauthBody | CreateManualBody;

export function toCreateInput(
  body: CreateConnectionBody,
  seal: (plain: string) => string,
): CreateConnectionInput {
  if (body.kind === "oauth") {
    const expiresAt = body.expiresAt ? Date.parse(body.expiresAt) : NaN;
    return {
      provider: body.provider,
      kind: "oauth",
      accountLogin: body.accountLogin,
      tokenSecretRef: seal(
        serializeOauthCredential({
          accessToken: body.token,
          ...(body.refreshToken ? { refreshToken: body.refreshToken } : {}),
          ...(Number.isFinite(expiresAt) ? { expiresAt } : {}),
        }),
      ),
    };
  }
  return {
    provider: body.provider,
    kind: "manual",
    accountLogin: body.accountLogin,
    tokenSecretRef: seal(body.credential),
  };
}
