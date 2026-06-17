import { AppError, type Env, NotFoundError, ValidationError, newId } from "@ss/shared";
import { and, desc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import {
  apps,
  deployments,
  notificationChannels,
  notificationDeliveries,
  notificationSubscriptions,
} from "../db/schema/index.js";
import { assertPublicUrl } from "../lib/public-url.js";
import {
  emailContent,
  sendEmail,
  smtpTransport,
  telegramHtml,
  telegramSend,
} from "../notifications/drivers.js";
import { loadMasterKey, open, seal } from "../secrets/crypto.js";
import type { SealedValue } from "../secrets/types.js";

// Notifications (30-notifications.md): outbound channels that fire on platform
// events. A `deploy.succeeded`/`deploy.failed` event fans out to each enabled,
// subscribed channel — generic webhook / Slack / Discord (POST), Telegram (bot
// API), or email (platform SMTP). Channel credentials (webhook URL, bot token,
// recipient) are sealed at rest in the secret store (11) and never returned on
// read.
const KEY_VERSION = 1;

// The events the platform actually emits today (others in the enum are future).
export const SUPPORTED_EVENTS = ["deploy.succeeded", "deploy.failed"] as const;
export type NotificationEventName = (typeof SUPPORTED_EVENTS)[number];
// Channel kinds: plain outbound POSTs (url), telegram (bot API), email (SMTP).
const URL_KINDS = ["webhook", "slack", "discord"] as const;
type ChannelKind = (typeof URL_KINDS)[number] | "telegram" | "email";

export type ChannelConfig = { url: string } | { botToken: string; chatId: string } | { to: string };

/** Per-kind create validation → the config object that gets sealed (pure). */
export function channelConfigFor(
  kind: string,
  input: { url?: string; botToken?: string; chatId?: string; to?: string },
): ChannelConfig {
  if ((URL_KINDS as readonly string[]).includes(kind)) {
    if (!input.url) throw new ValidationError(`a url is required for "${kind}" channels`);
    assertPublicUrl(input.url); // SSRF guard: no loopback/private targets
    return { url: input.url };
  }
  if (kind === "telegram") {
    if (!input.botToken) throw new ValidationError("botToken is required for telegram channels");
    if (!input.chatId) throw new ValidationError("chatId is required for telegram channels");
    return { botToken: input.botToken, chatId: input.chatId };
  }
  if (kind === "email") {
    if (!input.to) throw new ValidationError("a `to` recipient is required for email channels");
    return { to: input.to };
  }
  throw new ValidationError(`unsupported channel kind "${kind}"`);
}

function masterKey(config: Env): Buffer {
  try {
    return loadMasterKey(config.SHIPSQUARES_MASTER_KEY);
  } catch {
    throw new AppError("notifications require SHIPSQUARES_MASTER_KEY", {
      status: 400,
      code: "secrets.unconfigured",
    });
  }
}
const sealStr = (plain: string, config: Env): string =>
  JSON.stringify(seal(plain, masterKey(config), KEY_VERSION));
const openStr = (s: string, config: Env): string =>
  open(JSON.parse(s) as SealedValue, masterKey(config));

export interface ChannelView {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  events: string[];
  createdAt: string;
}

async function eventsFor(db: Db, channelId: string): Promise<string[]> {
  const rows = await db
    .select({ event: notificationSubscriptions.event })
    .from(notificationSubscriptions)
    .where(eq(notificationSubscriptions.channelId, channelId));
  return rows.map((r) => r.event);
}

export async function listChannels(db: Db, orgId: string): Promise<ChannelView[]> {
  const chans = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.organizationId, orgId))
    .orderBy(desc(notificationChannels.createdAt));
  const out: ChannelView[] = [];
  for (const c of chans) {
    out.push({
      id: c.id,
      kind: c.kind,
      name: c.name,
      enabled: c.enabled,
      events: await eventsFor(db, c.id),
      createdAt: c.createdAt.toISOString(),
    });
  }
  return out;
}

export async function createChannel(
  db: Db,
  config: Env,
  orgId: string,
  input: {
    kind: string;
    name: string;
    url?: string;
    botToken?: string;
    chatId?: string;
    to?: string;
    events?: string[];
  },
): Promise<ChannelView> {
  const channelConfig = channelConfigFor(input.kind, input);
  const events = (input.events?.length ? input.events : [...SUPPORTED_EVENTS]).filter((e) =>
    (SUPPORTED_EVENTS as readonly string[]).includes(e),
  );
  if (!events.length) throw new ValidationError("at least one supported event is required");

  const id = newId("nch");
  await db.insert(notificationChannels).values({
    id,
    organizationId: orgId,
    kind: input.kind as ChannelKind,
    name: input.name,
    configSecretRef: sealStr(JSON.stringify(channelConfig), config),
  });
  for (const event of events)
    await db
      .insert(notificationSubscriptions)
      .values({ id: newId("nsub"), channelId: id, event: event as NotificationEventName });

  return {
    id,
    kind: input.kind,
    name: input.name,
    enabled: true,
    events,
    createdAt: new Date().toISOString(),
  };
}

export async function deleteChannel(db: Db, orgId: string, id: string): Promise<void> {
  const rows = await db
    .delete(notificationChannels)
    .where(and(eq(notificationChannels.id, id), eq(notificationChannels.organizationId, orgId)))
    .returning({ id: notificationChannels.id });
  if (!rows[0]) throw new NotFoundError("channel not found");
}

/** Human one-liner for Slack/Discord. */
function message(event: NotificationEventName, p: DeployPayload): string {
  const ok = event === "deploy.succeeded";
  const commit = p.deployment.commit ? ` (${p.deployment.commit.slice(0, 7)})` : "";
  const why = !ok && p.deployment.error ? `: ${p.deployment.error}` : "";
  return `${ok ? "✅" : "❌"} Deploy ${ok ? "succeeded" : "failed"} — ${p.app.name}${commit}${why}`;
}

/** Render the POST body for a channel kind (pure → unit-tested). Slack wants
 *  `{text}`, Discord `{content}`; a generic webhook gets the full event payload. */
export function renderBody(kind: string, event: NotificationEventName, p: DeployPayload): string {
  if (kind === "slack") return JSON.stringify({ text: message(event, p) });
  if (kind === "discord") return JSON.stringify({ content: message(event, p) });
  return JSON.stringify(p); // generic webhook → the full event payload
}

async function deliver(
  db: Db,
  config: Env,
  channel: { id: string; kind: string; configSecretRef: string },
  event: NotificationEventName,
  payload: DeployPayload,
): Promise<boolean> {
  let status: "sent" | "failed" = "sent";
  let error: string | undefined;
  try {
    const cfg = JSON.parse(openStr(channel.configSecretRef, config)) as ChannelConfig;
    if ("botToken" in cfg) {
      const r = await telegramSend(cfg, telegramHtml(payload), fetch);
      if (!r.ok) {
        status = "failed";
        error = r.error ?? "telegram send failed";
      }
    } else if ("to" in cfg) {
      if (!config.SMTP_URL || !config.SMTP_FROM) {
        status = "failed";
        error = "smtp is not configured (SMTP_URL/SMTP_FROM)";
      } else {
        const content = emailContent(payload);
        const r = await sendEmail(smtpTransport(config.SMTP_URL), {
          from: config.SMTP_FROM,
          to: cfg.to,
          ...content,
        });
        if (!r.ok) {
          status = "failed";
          error = r.error ?? "email send failed";
        }
      }
    } else {
      assertPublicUrl(cfg.url); // re-check at send (rows may predate the guard)
      const res = await fetch(cfg.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: renderBody(channel.kind, event, payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        status = "failed";
        error = `HTTP ${res.status}`;
      }
    }
  } catch (e) {
    status = "failed";
    error = e instanceof Error ? e.message : String(e);
  }
  await db
    .insert(notificationDeliveries)
    .values({ channelId: channel.id, event, status, ...(error ? { error } : {}) });
  return status === "sent";
}

/** Fan a deploy event out to every enabled channel in the org subscribed to it.
 *  Each delivery is isolated — one failing channel never blocks the others, and
 *  the whole thing is best-effort (callers wrap in try/catch). */
async function dispatch(
  db: Db,
  config: Env,
  orgId: string,
  event: NotificationEventName,
  payload: DeployPayload,
): Promise<number> {
  const channels = await db
    .select({
      id: notificationChannels.id,
      kind: notificationChannels.kind,
      configSecretRef: notificationChannels.configSecretRef,
    })
    .from(notificationChannels)
    .innerJoin(
      notificationSubscriptions,
      eq(notificationSubscriptions.channelId, notificationChannels.id),
    )
    .where(
      and(
        eq(notificationChannels.organizationId, orgId),
        eq(notificationChannels.enabled, true),
        eq(notificationSubscriptions.event, event),
        eq(notificationSubscriptions.enabled, true),
      ),
    );
  let sent = 0;
  for (const c of channels) if (await deliver(db, config, c, event, payload)) sent += 1;
  return sent;
}

export interface DeployPayload {
  event: NotificationEventName;
  app: { id: string; name: string };
  deployment: {
    id: string;
    status: string;
    trigger: string;
    commit: string | null;
    error: string | null;
  };
  at: string;
}

/** Build the deploy payload from the DB and dispatch. Called by the executor on
 *  a terminal deploy status; best-effort so it never affects the deploy itself. */
export async function notifyDeploymentOutcome(
  db: Db,
  config: Env,
  deploymentId: string,
  event: NotificationEventName,
): Promise<void> {
  const dep = (
    await db.select().from(deployments).where(eq(deployments.id, deploymentId)).limit(1)
  )[0];
  if (!dep) return;
  const app = (
    await db.select({ name: apps.name }).from(apps).where(eq(apps.id, dep.appId)).limit(1)
  )[0];
  const payload: DeployPayload = {
    event,
    app: { id: dep.appId, name: app?.name ?? dep.appId },
    deployment: {
      id: dep.id,
      status: dep.status,
      trigger: dep.trigger,
      commit: dep.commitAfter ?? null,
      error: dep.errorMessage ?? null,
    },
    at: new Date().toISOString(),
  };
  await dispatch(db, config, dep.organizationId, event, payload);
}

/** Send a synthetic event to one channel so the user can verify it works. */
export async function testChannel(
  db: Db,
  config: Env,
  orgId: string,
  id: string,
): Promise<{ delivered: boolean }> {
  const channel = (
    await db
      .select({
        id: notificationChannels.id,
        kind: notificationChannels.kind,
        configSecretRef: notificationChannels.configSecretRef,
      })
      .from(notificationChannels)
      .where(and(eq(notificationChannels.id, id), eq(notificationChannels.organizationId, orgId)))
      .limit(1)
  )[0];
  if (!channel) throw new NotFoundError("channel not found");
  const payload: DeployPayload = {
    event: "deploy.succeeded",
    app: { id: "app_test", name: "test-app" },
    deployment: {
      id: "dpl_test",
      status: "succeeded",
      trigger: "manual",
      commit: "0000000",
      error: null,
    },
    at: new Date().toISOString(),
  };
  return { delivered: await deliver(db, config, channel, "deploy.succeeded", payload) };
}
