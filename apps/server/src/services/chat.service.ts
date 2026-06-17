import Anthropic from "@anthropic-ai/sdk";
import { AppError, NotFoundError, newId } from "@ss/shared";
import type { Env } from "@ss/shared";
import { and, asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { maskKey, resolveAi, type ResolvedAi } from "../chat/ai-settings.js";
import { buildAnthropicCreateMessage } from "../chat/anthropic.js";
import {
  dropLeadingAssistant,
  runToolLoop,
  type LoopMessage,
  type ToolEvent,
} from "../chat/loop.js";
import type { Db } from "../db/index.js";
import { aiSettings, conversations, messages } from "../db/schema/index.js";
import type { RequestContext } from "../lib/ctx.js";
import { MCP_TOOLS, buildRestCall, findTool } from "../mcp/tools.js";
import { checkPermission } from "../rbac/require-permission.js";
import { loadMasterKey, open, seal } from "../secrets/crypto.js";
import type { SealedValue } from "../secrets/types.js";

// The chat service (22-chatbot-agent.md): Claude with tool use over the MCP
// catalog, every tool call re-entering the REST API in-process with the
// caller's credential (the /mcp pattern) — RBAC, validation, and audit apply.
// Runtime = @anthropic-ai/sdk with the TDD'd runToolLoop (the plan's
// documented minimal-dep fallback; the Agent SDK needs the Claude Code
// runtime on the host, wrong for an embedded multi-tenant service).
// Conversations/messages persist with tool events in execution order (0010).

const KEY_VERSION = 1;
// Agentic answers interleave tool-use reasoning with prose; 1024 truncated
// real replies mid-sentence. 4096 gives room without runaway cost (maxTurns caps
// the loop).
const MAX_TOKENS = 4096;
const HISTORY_LIMIT = 30;
const TITLE_MAX = 80;

export const SYSTEM_PROMPT =
  "You are the ShipSquares assistant, operating a self-hosted deploy platform " +
  "on the user's behalf. Use the tools to inspect real state before answering; " +
  "never invent ids, apps, or statuses. Confirm destructive intent (deploys, " +
  "rollbacks, env changes) by stating exactly what you are about to do. Be concise.";

function masterKey(config: Env): Buffer {
  try {
    return loadMasterKey(config.SHIPSQUARES_MASTER_KEY);
  } catch {
    throw new AppError("AI settings require SHIPSQUARES_MASTER_KEY", {
      status: 400,
      code: "secrets.unconfigured",
    });
  }
}
const sealStr = (plain: string, config: Env): string =>
  JSON.stringify(seal(plain, masterKey(config), KEY_VERSION));
const openStr = (s: string, config: Env): string =>
  open(JSON.parse(s) as SealedValue, masterKey(config));

async function orgRow(db: Db, orgId: string) {
  return (
    await db.select().from(aiSettings).where(eq(aiSettings.organizationId, orgId)).limit(1)
  )[0];
}

/** Resolve the org's effective AI config + the PLAINTEXT key (never returned
 *  to clients — chatTurn/test consume it in-process only). */
async function resolveForOrg(
  db: Db,
  config: Env,
  orgId: string,
): Promise<ResolvedAi & { key: string | null }> {
  const row = await orgRow(db, orgId);
  const resolved = resolveAi(
    row ? { enabled: row.enabled, model: row.model, apiKeySecretRef: row.apiKeySecretRef } : null,
    config.ANTHROPIC_API_KEY ?? null,
  );
  let key: string | null = null;
  if (resolved.keySource === "org" && resolved.keyRef) key = openStr(resolved.keyRef, config);
  if (resolved.keySource === "platform") key = resolved.keyRef;
  return { ...resolved, key };
}

export interface AiSettingsView {
  enabled: boolean;
  configured: boolean;
  keySource: "org" | "platform" | "none";
  keyHint: string | null;
  model: string;
}

export async function getAiSettings(db: Db, config: Env, orgId: string): Promise<AiSettingsView> {
  const r = await resolveForOrg(db, config, orgId);
  return {
    enabled: r.enabled,
    configured: r.key !== null,
    keySource: r.keySource,
    keyHint: r.key ? maskKey(r.key) : null,
    model: r.model,
  };
}

export async function updateAiSettings(
  db: Db,
  config: Env,
  orgId: string,
  input: { apiKey?: string; model?: string; enabled?: boolean },
): Promise<AiSettingsView> {
  const existing = await orgRow(db, orgId);
  const patch = {
    ...(input.apiKey !== undefined ? { apiKeySecretRef: sealStr(input.apiKey, config) } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
  };
  if (existing) {
    await db.update(aiSettings).set(patch).where(eq(aiSettings.id, existing.id));
  } else {
    await db.insert(aiSettings).values({ id: newId("ai"), organizationId: orgId, ...patch });
  }
  return getAiSettings(db, config, orgId);
}

/** A 1-token round-trip proving the key + model work. */
export async function testAiSettings(
  db: Db,
  config: Env,
  orgId: string,
): Promise<{ ok: boolean; model?: string; error?: string }> {
  const r = await resolveForOrg(db, config, orgId);
  if (!r.enabled || !r.key) return { ok: false, error: "chat is not configured for this org" };
  try {
    const client = new Anthropic({ apiKey: r.key });
    await client.messages.create({
      model: r.model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true, model: r.model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ConversationView {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listConversations(db: Db, orgId: string): Promise<ConversationView[]> {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.organizationId, orgId))
    .orderBy(desc(conversations.updatedAt))
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export interface MessageView {
  id: string;
  ordinal: number;
  role: "user" | "assistant" | "tool";
  content: string;
  toolEvents: ToolEvent[] | null;
  createdAt: string;
}

export async function listMessages(
  db: Db,
  orgId: string,
  conversationId: string,
): Promise<MessageView[]> {
  const conv = (
    await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, orgId)))
      .limit(1)
  )[0];
  if (!conv) throw new NotFoundError("conversation not found");
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.ordinal));
  return rows.map((r) => ({
    id: r.id,
    ordinal: r.ordinal,
    role: r.role,
    content: r.content,
    toolEvents: (r.toolEvents as ToolEvent[] | null) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export interface ChatTurnResult {
  conversationId: string;
  text: string;
  toolEvents: ToolEvent[];
}

/** One user turn: persist the message, run the tool loop with the caller's
 *  credential, persist the assistant answer (+ tool events in order).
 *  `onToolEvent` streams per-tool progress to the SSE transport. */
export async function chatTurn(
  app: FastifyInstance,
  req: FastifyRequest,
  input: { conversationId?: string; message: string },
  onToolEvent?: (event: ToolEvent) => void,
): Promise<ChatTurnResult> {
  const ctx = req.ctx as RequestContext;
  const orgId = ctx.organizationId!;
  const r = await resolveForOrg(app.db, app.config, orgId);
  if (!r.enabled || !r.key) {
    throw new AppError("AI chat is not configured — set a key via /ai-settings", {
      status: 409,
      code: "ai.not_configured",
    });
  }

  // Load-or-create the conversation (org-scoped; 404 cross-tenant).
  let conversationId = input.conversationId ?? null;
  if (conversationId) {
    const conv = (
      await app.db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, orgId)))
        .limit(1)
    )[0];
    if (!conv) throw new NotFoundError("conversation not found");
  } else {
    conversationId = newId("conv");
    await app.db.insert(conversations).values({
      id: conversationId,
      organizationId: orgId,
      ...(ctx.actor.userId ? { userId: ctx.actor.userId } : {}),
      title: input.message.slice(0, TITLE_MAX),
    });
  }

  // Prior turns (text only — tool events are display metadata, not replayed).
  const prior = await app.db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.ordinal))
    .limit(HISTORY_LIMIT);
  const history: LoopMessage[] = dropLeadingAssistant(
    prior
      .reverse()
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  );
  history.push({ role: "user", content: input.message });
  let ordinal = prior.length ? Math.max(...prior.map((m) => m.ordinal)) + 1 : 0;

  const userMsgId = newId("msg");
  await app.db.insert(messages).values({
    id: userMsgId,
    conversationId,
    ordinal,
    role: "user",
    content: input.message,
  });
  ordinal += 1;

  // Tools = the MCP catalog this credential can use; execution re-enters the
  // REST API in-process with the caller's own headers.
  const allowed = MCP_TOOLS.filter((t) => checkPermission(ctx, t.permission).ok);
  const authHeaders: Record<string, string> = {};
  if (typeof req.headers.authorization === "string") {
    authHeaders.authorization = req.headers.authorization;
  }
  if (typeof req.headers.cookie === "string") authHeaders.cookie = req.headers.cookie;

  const client = new Anthropic({ apiKey: r.key });
  const createMessage = buildAnthropicCreateMessage(client, {
    model: r.model,
    system: SYSTEM_PROMPT,
    maxTokens: MAX_TOKENS,
    tools: allowed,
  });

  let result;
  try {
    result = await runToolLoop(
      {
        createMessage,
        ...(onToolEvent ? { onToolEvent } : {}),
        execTool: async (name, args) => {
          const tool = findTool(name);
          if (!tool) return { text: `unknown tool: ${name}`, isError: true };
          const call = buildRestCall(tool, args);
          const res = await app.inject({
            method: call.method,
            url: `/api/v1${call.url}`,
            headers: {
              ...authHeaders,
              ...(call.body !== undefined ? { "content-type": "application/json" } : {}),
            },
            ...(call.body !== undefined ? { payload: call.body } : {}),
          });
          return {
            text: res.body || `HTTP ${res.statusCode}`,
            ...(res.statusCode >= 400 ? { isError: true } : {}),
          };
        },
      },
      history,
    );
  } catch (err) {
    // Provider failure (bad key, rate limit, model error, network): roll back
    // the just-persisted user turn so the conversation isn't left with a
    // dangling question, and surface a clean 502 (both the SSE and JSON paths).
    await app.db
      .delete(messages)
      .where(eq(messages.id, userMsgId))
      .catch(() => undefined);
    throw new AppError(`AI provider error: ${err instanceof Error ? err.message : String(err)}`, {
      status: 502,
      code: "ai.provider_error",
    });
  }

  await app.db.insert(messages).values({
    id: newId("msg"),
    conversationId,
    ordinal,
    role: "assistant",
    content: result.text,
    ...(result.toolEvents.length
      ? { toolEvents: result.toolEvents as unknown as Record<string, unknown>[] }
      : {}),
  });
  await app.db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  return { conversationId, text: result.text, toolEvents: result.toolEvents };
}
