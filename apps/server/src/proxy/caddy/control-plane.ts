import type { Env } from "@ss/shared";

import { askEndpointUrl } from "../ask.js";
import type { DesiredApp, DesiredDomain } from "../types.js";

import { CaddyAdminClient } from "./client.js";
import { generateCaddyConfig } from "./config.js";

// The control plane registers ITS OWN edge route with Caddy at boot
// (08-proxy-ssl.md / 18-installer-ops.md): the dashboard/API at AUTH_URL's host
// is reverse-proxied to the local control-plane port with auto-HTTPS. This is
// what makes the login screen reachable over TLS at the configured domain.
// (Deployed apps' routes converge from the DB once the apps service lands; this
// only owns the self-route.)

/** Pure: the control plane's own desired proxy state, derived from config. */
export function controlPlaneDesired(config: Env): {
  apps: DesiredApp[];
  domains: DesiredDomain[];
} {
  const host = new URL(config.AUTH_URL).hostname;
  return {
    apps: [
      {
        appId: "control-plane",
        hosts: [host],
        target: { upstream: `127.0.0.1:${config.PORT}` },
        hsts: true,
        forceHttps: true,
      },
    ],
    domains: [{ fqdn: host, managed: "auto" }],
  };
}

/**
 * Ensure Caddy proxies the control-plane host to the local server. Throws if the
 * Caddy admin API is unreachable so the caller can log a non-fatal warning (dev
 * runs without Caddy still boot fine).
 */
export async function ensureControlPlaneProxy(config: Env): Promise<string> {
  const client = new CaddyAdminClient(config.CADDY_ADMIN_URL);
  if (!(await client.ping())) {
    throw new Error(`Caddy admin not reachable at ${config.CADDY_ADMIN_URL}`);
  }
  const desired = controlPlaneDesired(config);
  // Keep an explicit admin block in the loaded config so /load (a full replace)
  // doesn't reset the admin listener/origin allow-list — otherwise the next
  // boot's ping would 403. Mirrors infra/caddy/caddy.base.json.
  const adminHost = new URL(config.CADDY_ADMIN_URL).host;
  const loaded = {
    ...generateCaddyConfig({ ...desired, askEndpoint: askEndpointUrl(config.PORT) }),
    admin: { listen: adminHost, origins: [adminHost, "localhost:2019"] },
  };
  await client.load(loaded);
  return desired.apps[0]!.hosts[0]!;
}
