import { shq } from "../backups/commands.js";

// Private-registry login/logout (06-deploy-engine.md), adapted from Dokploy's
// services/registry.ts safeDockerLoginCommand (Apache-2.0, see NOTICE +
// 35-reuse-map.md): the password rides stdin (never argv/ps-visible) and every
// field is single-quote-escaped. Pure; the runtime runs these before pull/push.

export interface RegistryCredentials {
  /** registry host (empty = Docker Hub default) */
  registry: string;
  username: string;
  password: string;
}

export function dockerLoginCommand(creds: RegistryCredentials): string {
  const target = creds.registry ? ` ${shq(creds.registry)}` : "";
  return `printf %s ${shq(creds.password)} | docker login${target} -u ${shq(creds.username)} --password-stdin`;
}

export function dockerLogoutCommand(registry: string): string {
  return registry ? `docker logout ${shq(registry)}` : "docker logout";
}
