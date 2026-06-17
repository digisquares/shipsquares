import { Octokit } from "octokit";

import { generateAppJwt } from "./github-jwt.js";

// Resolve the account a GitHub App installation belongs to (26-vcs-connections.md).
// App-level auth: sign a short-lived App JWT (generateAppJwt) and GET the
// installation. Runtime (network) — the callback persists the returned login.
export async function lookupInstallationAccount(
  appId: string,
  privateKeyPem: string,
  installationId: string,
): Promise<{ login: string }> {
  const jwt = generateAppJwt(appId, privateKeyPem, Math.floor(Date.now() / 1000));
  const ok = new Octokit({ auth: jwt });
  const { data } = await ok.rest.apps.getInstallation({ installation_id: Number(installationId) });
  const account = data.account;
  const login = account && "login" in account ? account.login : undefined;
  return { login: login ?? "unknown" };
}
