import { randomBytes } from "node:crypto";

import { AppError, ConflictError, type Env, NotFoundError, newId } from "@ss/shared";
import { and, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { apps, inboundWebhooks, vcsAppRegistrations, vcsConnections } from "../db/schema/index.js";
import { executeDeploy } from "../deploy/executor.js";
import { swallow } from "../lib/swallow.js";
import { loadMasterKey, open, seal } from "../secrets/crypto.js";
import type { SealedValue } from "../secrets/types.js";
import { openSecretRef } from "../vcs/provider-deps.js";
import { safeRepoRefFromUrl } from "../vcs/repo-ref.js";
import { parseEvent } from "../webhooks/parse.js";
import type { Provider } from "../webhooks/types.js";
import { bitbucketVerify, giteaVerify, githubVerify, gitlabVerify } from "../webhooks/verify.js";

import { createDeployment } from "./deployments.service.js";
import { handlePullRequest } from "./previews.service.js";

// Inbound VCS webhooks → auto-deploy (10-webhooks-vcs.md). Each app gets one
// inbound webhook with a (sealed) HMAC secret; the public /hooks/:id endpoint
// verifies the signature on the RAW body, normalizes the payload, and triggers a
// deploy when the pushed branch matches the app's branch.
const KEY_VERSION = 1;
type Headers = Record<string, string | string[] | undefined>;

function header(headers: Headers, name: string): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function masterKey(config: Env): Buffer {
  try {
    return loadMasterKey(config.SHIPSQUARES_MASTER_KEY);
  } catch {
    throw new AppError("webhooks require SHIPSQUARES_MASTER_KEY", {
      status: 400,
      code: "secrets.unconfigured",
    });
  }
}
const sealStr = (plain: string, config: Env): string =>
  JSON.stringify(seal(plain, masterKey(config), KEY_VERSION));
const openStr = (s: string, config: Env): string =>
  open(JSON.parse(s) as SealedValue, masterKey(config));

function hookUrl(config: Env, id: string): string {
  return `${config.AUTH_URL.replace(/\/$/, "")}/hooks/${id}`;
}

async function assertApp(db: Db, orgId: string, appId: string): Promise<void> {
  const rows = await db
    .select({ id: apps.id })
    .from(apps)
    .where(and(eq(apps.id, appId), eq(apps.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("app not found");
}

export interface WebhookView {
  id: string;
  appId: string;
  provider: Provider;
  url: string;
  secret?: string; // returned only on create/rotate
}

/** Create (or rotate) the app's single inbound webhook; returns the secret once. */
export async function ensureWebhook(
  db: Db,
  config: Env,
  orgId: string,
  appId: string,
  provider: Provider = "github",
): Promise<WebhookView> {
  await assertApp(db, orgId, appId);
  const secret = randomBytes(24).toString("hex");
  const existing = (
    await db
      .select({ id: inboundWebhooks.id })
      .from(inboundWebhooks)
      .where(and(eq(inboundWebhooks.appId, appId), eq(inboundWebhooks.organizationId, orgId)))
      .limit(1)
  )[0];
  if (existing) {
    // Rotate IN PLACE: the id (and therefore the /hooks/:id URL pasted at the
    // provider) survives — only the secret changes.
    await db
      .update(inboundWebhooks)
      .set({ provider, secret: sealStr(secret, config) })
      .where(eq(inboundWebhooks.id, existing.id));
    return { id: existing.id, appId, provider, url: hookUrl(config, existing.id), secret };
  }
  const id = newId("whk");
  await db.insert(inboundWebhooks).values({
    id,
    appId,
    organizationId: orgId,
    provider,
    secret: sealStr(secret, config),
  });
  return { id, appId, provider, url: hookUrl(config, id), secret };
}

export async function getWebhook(
  db: Db,
  config: Env,
  orgId: string,
  appId: string,
): Promise<WebhookView | null> {
  await assertApp(db, orgId, appId);
  const wh = (
    await db
      .select()
      .from(inboundWebhooks)
      .where(and(eq(inboundWebhooks.appId, appId), eq(inboundWebhooks.organizationId, orgId)))
      .limit(1)
  )[0];
  // `provider` is always one of the 4 real providers (ensureWebhook never stores
  // "generic"); narrow the DB enum (which includes it) to the webhook Provider.
  return wh
    ? { id: wh.id, appId, provider: wh.provider as Provider, url: hookUrl(config, wh.id) }
    : null;
}

/** Persist the provider-side hook id after remote registration (R2.2) so a
 *  future removeWebhook can target the exact hook instead of guessing. */
export async function setRemoteHookId(
  db: Db,
  orgId: string,
  webhookId: string,
  remoteId: string,
): Promise<void> {
  await db
    .update(inboundWebhooks)
    .set({ remoteId })
    .where(and(eq(inboundWebhooks.id, webhookId), eq(inboundWebhooks.organizationId, orgId)));
}

/** Pure signature check, dispatched by provider (security-critical → unit-tested).
 *  Bitbucket sends no signature header — it authenticates via a `?token=`
 *  secret on the hook URL, passed through as `urlToken`. */
export function verifyInboundSignature(
  provider: Provider,
  rawBody: Buffer,
  headers: Headers,
  secret: string,
  urlToken?: string,
): boolean {
  switch (provider) {
    case "github":
      return githubVerify(rawBody, header(headers, "x-hub-signature-256"), secret);
    case "gitea":
      return giteaVerify(rawBody, header(headers, "x-gitea-signature"), secret);
    case "gitlab":
      return gitlabVerify(header(headers, "x-gitlab-token"), secret);
    case "bitbucket":
      return bitbucketVerify(urlToken, secret);
  }
}

export interface InboundResult {
  status: number;
  body: Record<string, unknown>;
}

/** Verify → parse → branch-match → trigger a deploy. Never throws to the caller
 *  for expected outcomes (bad signature, branch mismatch); they map to a status. */
export async function handleInbound(
  db: Db,
  config: Env,
  webhookId: string,
  headers: Headers,
  rawBody: Buffer,
  queue: { send(name: string, data: object): Promise<unknown> } | null = null,
  urlToken?: string,
): Promise<InboundResult> {
  const wh = (
    await db.select().from(inboundWebhooks).where(eq(inboundWebhooks.id, webhookId)).limit(1)
  )[0];
  if (!wh) return { status: 404, body: { code: "not_found" } };
  const provider = wh.provider as Provider;

  let secret: string;
  try {
    secret = openStr(wh.secret, config);
  } catch {
    return { status: 500, body: { code: "secrets.unconfigured" } };
  }
  if (!verifyInboundSignature(provider, rawBody, headers, secret, urlToken)) {
    return { status: 401, body: { code: "webhook.invalid_signature" } };
  }

  // GitHub/Gitea send a ping when the hook is created — acknowledge, don't deploy.
  if (header(headers, "x-github-event") === "ping" || header(headers, "x-gitea-event") === "ping") {
    return { status: 200, body: { ok: true, ping: true } };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { status: 400, body: { code: "webhook.bad_payload" } };
  }
  const deliveryId =
    header(headers, "x-github-delivery") ?? header(headers, "x-gitea-delivery") ?? "";
  const event = parseEvent(provider, payload, deliveryId, "push");

  const app = (
    await db
      .select()
      .from(apps)
      .where(and(eq(apps.id, wh.appId), eq(apps.organizationId, wh.organizationId)))
      .limit(1)
  )[0];
  if (!app) return { status: 404, body: { code: "not_found" } };

  // PR events route to the preview lifecycle (31), not the push→deploy path.
  if (header(headers, "x-github-event") === "pull_request") {
    return handlePullRequest(db, config, queue, app, payload);
  }

  if (!event.branch || event.branch !== app.branch) {
    return {
      status: 200,
      body: {
        ignored: true,
        reason: "branch does not match app",
        branch: event.branch,
        expected: app.branch,
      },
    };
  }

  let dep;
  try {
    dep = await createDeployment(db, wh.organizationId, wh.appId, { trigger: "push" });
  } catch (err) {
    // Per-app serialization: a push during an active deploy is
    // acknowledged, not errored — provider retries would just re-collide.
    if (err instanceof ConflictError) {
      return {
        status: 200,
        body: { ignored: true, reason: "a deployment is already in progress" },
      };
    }
    throw err;
  }
  // Inline (this service has no queue handle) — the boot sweep only reaps
  // running rows, so an inline run dying with the process is recorded failed.
  void executeDeploy(db, dep.id).catch((e) => swallow("webhook.inline_deploy", e));
  return {
    status: 202,
    body: { deploymentId: dep.id, branch: event.branch, commit: event.commit },
  };
}

/** Pure: which connection-bound apps target the webhook's repo. Each app's repo
 *  is a git URL; we parse owner/name and compare case-insensitively to the
 *  payload's `repository.full_name`. Apps without a parseable https repo (ssh,
 *  catalog, image) never match. */
export function matchAppsByRepo<T extends { repo: string | null; branch: string }>(
  boundApps: T[],
  repoFullName: string,
): T[] {
  const target = repoFullName.toLowerCase();
  if (!target) return [];
  return boundApps.filter((a) => {
    if (!a.repo) return false;
    const ref = safeRepoRefFromUrl(a.repo, a.branch);
    return ref != null && ref.fullName.toLowerCase() === target;
  });
}

/** App-level inbound webhook (R2.7): one webhook for a manifest-created App,
 *  resolved by the `X-GitHub-Hook-Installation-Target-ID` (app id) header to its
 *  sealed webhook secret. Verifies the signature, then fans out by
 *  installation → connection → bound apps: push→deploy (branch match),
 *  pull_request→preview. `installation.deleted` prunes the stale connection so
 *  uninstalling on GitHub doesn't leave orphan rows. */
export async function handleAppInbound(
  db: Db,
  config: Env,
  headers: Headers,
  rawBody: Buffer,
  queue: { send(name: string, data: object): Promise<unknown> } | null = null,
): Promise<InboundResult> {
  const targetId = header(headers, "x-github-hook-installation-target-id");
  if (!targetId) return { status: 400, body: { code: "webhook.missing_target" } };

  const reg = (
    await db
      .select()
      .from(vcsAppRegistrations)
      .where(eq(vcsAppRegistrations.appId, targetId))
      .limit(1)
  )[0];
  if (!reg) return { status: 404, body: { code: "not_found" } };

  let webhookSecret: string;
  try {
    const creds = JSON.parse(openSecretRef(reg.credentialsSecretRef, config)) as {
      webhookSecret: string;
    };
    webhookSecret = creds.webhookSecret;
  } catch {
    return { status: 500, body: { code: "secrets.unconfigured" } };
  }
  if (!githubVerify(rawBody, header(headers, "x-hub-signature-256"), webhookSecret)) {
    return { status: 401, body: { code: "webhook.invalid_signature" } };
  }

  const event = header(headers, "x-github-event");
  if (event === "ping") return { status: 200, body: { ok: true, ping: true } };

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
  } catch {
    return { status: 400, body: { code: "webhook.bad_payload" } };
  }

  const installation = payload.installation as { id?: unknown } | undefined;
  const installationId = installation?.id != null ? String(installation.id) : "";

  // Uninstall → prune the connection. Other installation(_repositories) actions
  // are acknowledged (the App queries repos live, doesn't store them).
  if (event === "installation" || event === "installation_repositories") {
    if (payload.action === "deleted" && installationId) {
      await db
        .delete(vcsConnections)
        .where(
          and(
            eq(vcsConnections.organizationId, reg.organizationId),
            eq(vcsConnections.installationId, installationId),
          ),
        );
      return { status: 200, body: { ok: true, uninstalled: true } };
    }
    return { status: 200, body: { ok: true, ignored: String(payload.action ?? "") } };
  }

  if (event !== "push" && event !== "pull_request") {
    return { status: 200, body: { ok: true, ignored: event ?? "" } };
  }
  if (!installationId) return { status: 400, body: { code: "webhook.missing_installation" } };

  const conn = (
    await db
      .select()
      .from(vcsConnections)
      .where(
        and(
          eq(vcsConnections.organizationId, reg.organizationId),
          eq(vcsConnections.installationId, installationId),
        ),
      )
      .limit(1)
  )[0];
  if (!conn) {
    return { status: 202, body: { ignored: true, reason: "no connection for installation" } };
  }

  const repository = payload.repository as { full_name?: unknown } | undefined;
  const repoFullName = typeof repository?.full_name === "string" ? repository.full_name : "";
  const bound = await db
    .select()
    .from(apps)
    .where(and(eq(apps.organizationId, reg.organizationId), eq(apps.vcsConnectionId, conn.id)));
  const matched = matchAppsByRepo(bound, repoFullName);
  if (matched.length === 0) {
    return {
      status: 202,
      body: { ignored: true, reason: "no app bound to repo", repo: repoFullName },
    };
  }

  if (event === "pull_request") {
    for (const a of matched) await handlePullRequest(db, config, queue, a, payload);
    return { status: 200, body: { ok: true, previews: matched.length } };
  }

  // push → deploy every matched app whose branch matches the pushed ref.
  const deliveryId = header(headers, "x-github-delivery") ?? "";
  const parsed = parseEvent("github", payload, deliveryId, "push");
  const deployed: string[] = [];
  for (const a of matched) {
    if (!parsed.branch || parsed.branch !== a.branch) continue;
    try {
      const dep = await createDeployment(db, reg.organizationId, a.id, { trigger: "push" });
      void executeDeploy(db, dep.id).catch((e) => swallow("webhook.inline_deploy", e));
      deployed.push(dep.id);
    } catch (err) {
      // A push during an active deploy is acknowledged (serialization), not errored.
      if (err instanceof ConflictError) continue;
      throw err;
    }
  }
  return { status: 202, body: { deployed, branch: parsed.branch ?? null } };
}
