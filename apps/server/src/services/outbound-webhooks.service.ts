import { AppError, NotFoundError, ValidationError, newId } from "@ss/shared";
import type { Env } from "@ss/shared";
import { and, desc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import {
  apps,
  deployments,
  outboundWebhookDeliveries,
  outboundWebhooks,
} from "../db/schema/index.js";
import { assertPublicUrl } from "../lib/public-url.js";
import { loadMasterKey, open, seal } from "../secrets/crypto.js";
import type { SealedValue } from "../secrets/types.js";
import { PLATFORM_EVENTS, buildOutboundDelivery, matchesEvent } from "../webhooks/outbound.js";

// Outbound platform webhooks (10-webhooks-vcs.md): org-scoped subscriptions
// that POST signed {event, data} JSON to machine consumers. URLs are
// SSRF-guarded at create AND at send (a DNS flip must not reach loopback);
// the optional signing secret is sealed at rest; every attempt lands in
// outbound_webhook_deliveries. Dispatch is best-effort and never throws.

const KEY_VERSION = 1;
const SEND_TIMEOUT_MS = 10_000;

function masterKey(config: Env): Buffer {
  try {
    return loadMasterKey(config.SHIPSQUARES_MASTER_KEY);
  } catch {
    throw new AppError("outbound webhook secrets require SHIPSQUARES_MASTER_KEY", {
      status: 400,
      code: "secrets.unconfigured",
    });
  }
}
const sealStr = (plain: string, config: Env): string =>
  JSON.stringify(seal(plain, masterKey(config), KEY_VERSION));
const openStr = (s: string, config: Env): string =>
  open(JSON.parse(s) as SealedValue, masterKey(config));

type HookRow = typeof outboundWebhooks.$inferSelect;

export interface OutboundWebhookView {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  hasSecret: boolean;
  createdAt: string;
}

function toView(r: HookRow): OutboundWebhookView {
  return {
    id: r.id,
    url: r.url,
    events: r.events,
    active: r.active,
    hasSecret: r.secret !== null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listOutboundWebhooks(db: Db, orgId: string): Promise<OutboundWebhookView[]> {
  const rows = await db
    .select()
    .from(outboundWebhooks)
    .where(eq(outboundWebhooks.organizationId, orgId))
    .orderBy(desc(outboundWebhooks.createdAt));
  return rows.map(toView);
}

export interface CreateOutboundWebhookInput {
  url: string;
  events: string[];
  secret?: string;
}

export async function createOutboundWebhook(
  db: Db,
  config: Env,
  orgId: string,
  input: CreateOutboundWebhookInput,
): Promise<OutboundWebhookView> {
  try {
    assertPublicUrl(input.url);
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : "url is not deliverable");
  }
  const known = new Set<string>([...PLATFORM_EVENTS, "*"]);
  const unknown = input.events.filter((e) => !known.has(e));
  if (input.events.length === 0 || unknown.length > 0) {
    throw new ValidationError(
      `events must be a non-empty subset of ${[...known].join(", ")}` +
        (unknown.length ? ` (unknown: ${unknown.join(", ")})` : ""),
    );
  }
  const rows = await db
    .insert(outboundWebhooks)
    .values({
      id: newId("owh"),
      organizationId: orgId,
      url: input.url,
      events: input.events,
      ...(input.secret ? { secret: sealStr(input.secret, config) } : {}),
    })
    .returning();
  return toView(rows[0]!);
}

export async function deleteOutboundWebhook(db: Db, orgId: string, id: string): Promise<void> {
  const rows = await db
    .delete(outboundWebhooks)
    .where(and(eq(outboundWebhooks.id, id), eq(outboundWebhooks.organizationId, orgId)))
    .returning({ id: outboundWebhooks.id });
  if (!rows[0]) throw new NotFoundError("outbound webhook not found");
}

export interface OutboundDeliveryView {
  deliveryId: string;
  event: string;
  status: string;
  httpStatus: number | null;
  error: string | null;
  createdAt: string;
}

export async function listOutboundDeliveries(
  db: Db,
  orgId: string,
  webhookId: string,
): Promise<OutboundDeliveryView[]> {
  const hook = (
    await db
      .select({ id: outboundWebhooks.id })
      .from(outboundWebhooks)
      .where(and(eq(outboundWebhooks.id, webhookId), eq(outboundWebhooks.organizationId, orgId)))
      .limit(1)
  )[0];
  if (!hook) throw new NotFoundError("outbound webhook not found");
  const rows = await db
    .select()
    .from(outboundWebhookDeliveries)
    .where(eq(outboundWebhookDeliveries.webhookId, webhookId))
    .orderBy(desc(outboundWebhookDeliveries.createdAt))
    .limit(50);
  return rows.map((r) => ({
    deliveryId: r.deliveryId,
    event: r.event,
    status: r.status,
    httpStatus: r.httpStatus,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Fan one event out to every subscribed active hook. Best-effort: failures
 *  land in the delivery rows, never on the caller. */
export async function dispatchOutbound(
  db: Db,
  config: Env,
  orgId: string,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const hooks = await db
    .select()
    .from(outboundWebhooks)
    .where(and(eq(outboundWebhooks.organizationId, orgId), eq(outboundWebhooks.active, true)));
  for (const hook of hooks) {
    if (!matchesEvent(hook.events, event)) continue;
    const deliveryId = newId("dlv");
    let status: "sent" | "failed" = "sent";
    let httpStatus: number | null = null;
    let error: string | undefined;
    try {
      assertPublicUrl(hook.url); // re-checked at send: DNS may have moved
      const secret = hook.secret ? openStr(hook.secret, config) : null;
      const delivery = buildOutboundDelivery(event, data, { deliveryId, secret });
      const res = await fetch(hook.url, {
        method: "POST",
        headers: delivery.headers,
        body: delivery.body,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        redirect: "error", // a redirect could re-point the delivery anywhere
      });
      httpStatus = res.status;
      if (!res.ok) {
        status = "failed";
        error = `endpoint answered ${res.status}`;
      }
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : String(err);
    }
    await db
      .insert(outboundWebhookDeliveries)
      .values({
        webhookId: hook.id,
        deliveryId,
        event,
        status,
        httpStatus,
        ...(error ? { error } : {}),
      })
      .catch(() => undefined);
  }
}

/** Deploy-outcome fan-out, mirroring notifyDeploymentOutcome's payload. */
export async function dispatchDeploymentOutcome(
  db: Db,
  config: Env,
  deploymentId: string,
  event: "deploy.succeeded" | "deploy.failed",
): Promise<void> {
  const dep = (
    await db.select().from(deployments).where(eq(deployments.id, deploymentId)).limit(1)
  )[0];
  if (!dep) return;
  const app = (
    await db.select({ name: apps.name }).from(apps).where(eq(apps.id, dep.appId)).limit(1)
  )[0];
  await dispatchOutbound(db, config, dep.organizationId, event, {
    app: { id: dep.appId, name: app?.name ?? dep.appId },
    deployment: {
      id: dep.id,
      status: dep.status,
      trigger: dep.trigger,
      commit: dep.commitAfter ?? null,
      error: dep.errorMessage ?? null,
    },
    at: new Date().toISOString(),
  });
}
