import type { Env } from "@ss/shared";
import { and, desc, eq, ne } from "drizzle-orm";

import type { Db } from "../../db/index.js";
import { deployments, domains, previewEnvironments } from "../../db/schema/index.js";
import type { DeployMeta } from "../../deploy/executor.js";
import { createMutex } from "../../lib/mutex.js";
import { previewRoutes, type PreviewRouteEntry } from "../../previews/orchestrator.js";
import { askEndpointUrl } from "../ask.js";
import type { DesiredApp, DesiredDomain } from "../types.js";

import { CaddyAdminClient } from "./client.js";
import { generateCaddyConfig } from "./config.js";
import { controlPlaneDesired } from "./control-plane.js";

// Converge Caddy to the desired state (08-proxy-ssl.md): the control-plane's own
// edge route PLUS a reverse-proxy route for every app domain whose app has a
// running container (a succeeded deployment with a published loopback port).
// Re-run on boot, after a successful deploy, and after a domain add/remove.

export interface DomainEntry {
  appId: string;
  fqdn: string;
  https: boolean;
  hostPort?: string; // the running container's published port, if deployed
  host?: string; // host the port is reachable on — worker IP for remote apps (R4.1)
}

/** Pure: domain rows (+ their app's running port) → Caddy desired app routes.
 *  Domains whose app has no running container yet are skipped (no upstream). */
export function appRoutesFromDomains(entries: DomainEntry[]): {
  apps: DesiredApp[];
  domains: DesiredDomain[];
} {
  const apps: DesiredApp[] = [];
  const desiredDomains: DesiredDomain[] = [];
  for (const e of entries) {
    if (!e.hostPort) continue;
    apps.push({
      appId: e.appId,
      hosts: [e.fqdn],
      target: { upstream: `${e.host ?? "127.0.0.1"}:${e.hostPort}` },
      hsts: true,
      forceHttps: e.https,
    });
    desiredDomains.push({ fqdn: e.fqdn, managed: "auto" });
  }
  return { apps, domains: desiredDomains };
}

/** Running previews with a domain — their hostPort rides the linked
 *  deployment's meta (stamped by the preview deploy path). */
async function loadPreviewEntries(db: Db): Promise<PreviewRouteEntry[]> {
  const rows = await db
    .select()
    .from(previewEnvironments)
    .where(eq(previewEnvironments.status, "running"));
  const entries: PreviewRouteEntry[] = [];
  for (const r of rows) {
    if (!r.domain) continue;
    let hostPort: string | undefined;
    if (r.deploymentId) {
      const dep = (
        await db
          .select({ meta: deployments.meta })
          .from(deployments)
          .where(eq(deployments.id, r.deploymentId))
          .limit(1)
      )[0];
      hostPort = (dep?.meta as DeployMeta | undefined)?.hostPort;
    }
    entries.push({ appId: r.appId, domain: r.domain, ...(hostPort ? { hostPort } : {}) });
  }
  return entries;
}

async function loadDomainEntries(db: Db): Promise<DomainEntry[]> {
  const rows = await db.select().from(domains);
  const entries: DomainEntry[] = [];
  for (const d of rows) {
    const dep = (
      await db
        .select({ meta: deployments.meta })
        .from(deployments)
        .where(
          and(
            eq(deployments.appId, d.appId),
            eq(deployments.status, "succeeded"),
            // preview deploys carry their own FQDN — they must never become
            // the upstream for the app's PRODUCTION domains
            ne(deployments.trigger, "preview"),
          ),
        )
        .orderBy(desc(deployments.finishedAt))
        .limit(1)
    )[0];
    const meta = dep?.meta as DeployMeta | undefined;
    entries.push({
      appId: d.appId,
      fqdn: d.fqdn,
      https: d.https,
      ...(meta?.hostPort ? { hostPort: meta.hostPort } : {}),
      ...(meta?.host ? { host: meta.host } : {}),
    });
  }
  return entries;
}

// Converges race from deploys, domain changes, and lifecycle ops — full-config
// /load must be serialized or a stale snapshot can apply last.
const convergeMutex = createMutex();

/** Build the full Caddy config from DB state and load it. Throws if the admin
 *  API is unreachable (callers treat that as a non-fatal warning). */
export function convergeProxy(db: Db, config: Env): Promise<void> {
  return convergeMutex.run(() => doConverge(db, config));
}

async function doConverge(db: Db, config: Env): Promise<void> {
  const client = new CaddyAdminClient(config.CADDY_ADMIN_URL);
  if (!(await client.ping())) {
    throw new Error(`Caddy admin not reachable at ${config.CADDY_ADMIN_URL}`);
  }

  const cp = controlPlaneDesired(config);
  const fromDomains = appRoutesFromDomains(await loadDomainEntries(db));
  const fromPreviews = previewRoutes(await loadPreviewEntries(db));

  const adminHost = new URL(config.CADDY_ADMIN_URL).host;
  const loaded = {
    ...generateCaddyConfig({
      apps: [...cp.apps, ...fromDomains.apps, ...fromPreviews.apps],
      domains: [...cp.domains, ...fromDomains.domains, ...fromPreviews.domains],
      askEndpoint: askEndpointUrl(config.PORT),
    }),
    admin: { listen: adminHost, origins: [adminHost, "localhost:2019"] },
  };
  await client.load(loaded);
}
