import { randomUUID } from "node:crypto";

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";
import type {
  ChatInputRequestEvent,
  ChatPlanEvent,
  ChatStreamEvent,
  ChatStreamEventName,
  ChatToolRisk,
} from "@ss/shared";

import { getOrgId, type RequestContext } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as chatService from "../services/chat.service.js";

// Human-in-the-loop approvals for the assistant's write/destructive tools
// (ai-assistant-roadmap.md). The streaming turn blocks on requestApproval, which
// parks a resolver here and emits an SSE `approval` event; POST /chat/approve
// resolves it. Single control-plane process ⇒ an in-memory map is fine; entries
// auto-decline on timeout, and the random id is the unguessable capability.
const APPROVAL_TIMEOUT_MS = 120_000;

// A parked resolver, bound to the org + user that owns the streaming turn, so only
// that session can answer it (the random id is the capability; the owner check stops
// another member from resolving someone else's pending action even if they learn it).
interface Pending<T> {
  resolve: (value: T) => void;
  orgId: string;
  userId: string | null;
}
type Owner = { orgId: string; userId: string | null };
const ownerOf = (req: { ctx?: RequestContext }): Owner => ({
  orgId: req.ctx?.organizationId ?? "",
  userId: req.ctx?.actor.userId ?? null,
});
function resolvePending<T>(
  map: Map<string, Pending<T>>,
  id: string,
  owner: Owner,
  value: T,
): boolean {
  const entry = map.get(id);
  if (!entry || entry.orgId !== owner.orgId || entry.userId !== owner.userId) return false;
  entry.resolve(value);
  return true;
}

const pendingApprovals = new Map<string, Pending<boolean>>();

// Structured input requests (ai-multistep-conversations.md Phase B) work the same
// way: the streaming turn blocks on requestInput, which parks a resolver here and
// emits an SSE `input_request` event; POST /chat/answer resolves it with the
// user's answers (or null to cancel). A form can take a while to fill, so the
// timeout is more generous than approvals'.
const INPUT_TIMEOUT_MS = 300_000;
const pendingInputs = new Map<string, Pending<Record<string, unknown> | null>>();

// AI chat + settings (22-chatbot-agent.md). Chat needs only the member floor
// (the tool loop re-enforces per-tool RBAC through the API); the BYO key is
// org-admin territory (org:write) and write-only — clients see hasSecret-style
// hints, never the key.

const ToolEvent = T.Object({
  tool: T.String(),
  input: T.Record(T.String(), T.Unknown()),
  result: T.String(),
  isError: T.Optional(T.Boolean()),
});

const ChatBody = T.Object(
  {
    conversationId: T.Optional(T.String()),
    message: T.String({ minLength: 1, maxLength: 8192 }),
    // Optional page context (e.g. "viewing app app_123") so "this app" resolves;
    // injected into the system prompt, never persisted as the user's message.
    context: T.Optional(T.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

const Usage = T.Object({
  inputTokens: T.Integer(),
  outputTokens: T.Integer(),
  cacheReadTokens: T.Optional(T.Integer()),
  cacheWriteTokens: T.Optional(T.Integer()),
});

const ChatResult = T.Object({
  conversationId: T.String(),
  text: T.String(),
  toolEvents: T.Array(ToolEvent),
  usage: T.Optional(Usage),
});

const AiSettings = T.Object({
  enabled: T.Boolean(),
  configured: T.Boolean(),
  keySource: T.Union([T.Literal("org"), T.Literal("platform"), T.Literal("none")]),
  keyHint: T.Union([T.String(), T.Null()]),
  model: T.String(),
  thinking: T.Boolean(),
});

const UpdateAiSettings = T.Object(
  {
    apiKey: T.Optional(T.String({ minLength: 8, maxLength: 256 })),
    model: T.Optional(T.String({ minLength: 1, maxLength: 64 })),
    enabled: T.Optional(T.Boolean()),
    thinking: T.Optional(T.Boolean()),
  },
  { additionalProperties: false },
);

const Conversation = T.Object({
  id: T.String(),
  title: T.Union([T.String(), T.Null()]),
  createdAt: T.String({ format: "date-time" }),
  updatedAt: T.String({ format: "date-time" }),
});

const Message = T.Object({
  id: T.String(),
  ordinal: T.Integer(),
  role: T.Union([T.Literal("user"), T.Literal("assistant"), T.Literal("tool")]),
  content: T.String(),
  toolEvents: T.Union([T.Array(ToolEvent), T.Null()]),
  createdAt: T.String({ format: "date-time" }),
});

const IdParam = T.Object({ id: T.String() });

export const chatRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // One turn: persist, run the tool loop, answer. `Accept: text/event-stream`
  // streams progress as SSE — `tool` events as each tool finishes, then
  // `done` with the full result (or `error`); plain JSON stays the default
  // for non-streaming consumers.
  app.post(
    "/chat",
    {
      schema: {
        tags: ["chat"],
        summary: "Run one AI assistant turn (shared engine; web/mobile/CLI clients)",
        description:
          "One turn of the server-side AI assistant. With `Accept: text/event-stream` the " +
          "response is an SSE stream of `tool`/`delta`/`approval`/`input_request`/`plan` events " +
          "ending in exactly one `done` or `error` — this path supports the FULL feature set: " +
          "write/destructive tools via the approval handshake (`POST /chat/approve`), structured " +
          "elicitation (`POST /chat/answer`), and multi-step plans. Without that Accept header " +
          "the response is the final JSON result only and write/destructive tools are declined " +
          "(no approval transport). All clients (web, native mobile, CLI) should use the SSE path " +
          "for parity. Event payload shapes: the ChatStreamEvent contract in @ss/shared; full " +
          "protocol in docs/ai-assistant-api.md.",
        body: ChatBody,
        response: { 200: ChatResult, 404: Problem, 409: Problem },
      },
      preHandler: app.requirePermission("app:read"),
    },
    async (req, reply) => {
      if (!req.headers.accept?.includes("text/event-stream")) {
        return chatService.chatTurn(app, req, req.body);
      }
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      // Cooperative cancellation: when the client disconnects (closes the stream /
      // hits Stop), stop running more model/tool calls instead of finishing the turn.
      let aborted = false;
      reply.raw.on("close", () => {
        aborted = true;
      });
      // Typed against the shared ChatStreamEvent contract (@ss/shared) so the engine
      // can't emit a shape clients don't expect. Don't write to a socket the client
      // already closed (mid-turn disconnect).
      const send = <E extends ChatStreamEventName>(
        event: E,
        data: Extract<ChatStreamEvent, { event: E }>["data"],
      ) => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        }
      };
      const owner = ownerOf(req);
      // Pause a write/destructive tool until the user approves via /chat/approve.
      const requestApproval = (r: {
        tool: string;
        input: Record<string, unknown>;
        risk: ChatToolRisk;
      }) =>
        new Promise<boolean>((resolve) => {
          const id = randomUUID();
          const timer = setTimeout(() => {
            pendingApprovals.delete(id);
            resolve(false);
          }, APPROVAL_TIMEOUT_MS);
          pendingApprovals.set(id, {
            resolve: (approved) => {
              clearTimeout(timer);
              pendingApprovals.delete(id);
              resolve(approved);
            },
            ...owner,
          });
          send("approval", { id, ...r });
        });
      // Pause while the assistant collects structured details via a form.
      const requestInput = (input: Record<string, unknown>) =>
        new Promise<Record<string, unknown> | null>((resolve) => {
          const id = randomUUID();
          const timer = setTimeout(() => {
            pendingInputs.delete(id);
            resolve(null);
          }, INPUT_TIMEOUT_MS);
          pendingInputs.set(id, {
            resolve: (answers) => {
              clearTimeout(timer);
              pendingInputs.delete(id);
              resolve(answers);
            },
            ...owner,
          });
          send("input_request", { id, ...input } as ChatInputRequestEvent);
        });
      // Pause while the user reviews a proposed multi-step plan (Phase C). The
      // decision is a boolean, so it reuses the approval registry + /chat/approve;
      // only the SSE event type (`plan`) differs.
      const requestPlan = (plan: Record<string, unknown>) =>
        new Promise<boolean>((resolve) => {
          const id = randomUUID();
          const timer = setTimeout(() => {
            pendingApprovals.delete(id);
            resolve(false);
          }, APPROVAL_TIMEOUT_MS);
          pendingApprovals.set(id, {
            resolve: (approved) => {
              clearTimeout(timer);
              pendingApprovals.delete(id);
              resolve(approved);
            },
            ...owner,
          });
          send("plan", { id, ...plan } as ChatPlanEvent);
        });
      try {
        const result = await chatService.chatTurn(
          app,
          req,
          req.body,
          (e) => send("tool", e),
          (text) => send("delta", { text }),
          requestApproval,
          requestInput,
          requestPlan,
          () => aborted,
        );
        send("done", result);
      } catch (err) {
        const e = err as { message?: string; code?: string };
        send("error", { message: e.message ?? "chat failed", code: e.code ?? "chat.failed" });
      } finally {
        reply.raw.end();
      }
    },
  );

  // Approve/decline a pending write/destructive action the assistant proposed mid-turn.
  // The streaming turn is blocked on it; resolving here lets the tool loop continue.
  app.post(
    "/chat/approve",
    {
      schema: {
        tags: ["chat"],
        summary: "Approve/decline a pending action or plan from a chat turn",
        description:
          "Resolves an `approval` or `plan` SSE event (from `POST /chat`) by its id. Only the " +
          "org + user that owns the streaming turn may resolve it; `ok:false` if unknown, " +
          "expired, or not the owner.",
        body: T.Object({ id: T.String(), approve: T.Boolean() }, { additionalProperties: false }),
        response: { 200: T.Object({ ok: T.Boolean() }) },
      },
      preHandler: app.requirePermission("app:read"),
    },
    async (req) => {
      // Only the org+user that owns the pending turn may resolve it.
      return { ok: resolvePending(pendingApprovals, req.body.id, ownerOf(req), req.body.approve) };
    },
  );

  // Submit (or cancel) the structured details the assistant requested mid-turn.
  // Omitting `answers` cancels; the blocked tool loop resumes either way.
  app.post(
    "/chat/answer",
    {
      schema: {
        tags: ["chat"],
        summary: "Submit/cancel a structured input request from a chat turn",
        description:
          "Resolves an `input_request` SSE event (from `POST /chat`) by its id; omit `answers` " +
          "to cancel. Owner-bound (same org + user as the streaming turn).",
        body: T.Object(
          {
            id: T.String(),
            answers: T.Optional(T.Record(T.String(), T.Unknown())),
          },
          { additionalProperties: false },
        ),
        response: { 200: T.Object({ ok: T.Boolean() }) },
      },
      preHandler: app.requirePermission("app:read"),
    },
    async (req) => {
      return {
        ok: resolvePending(pendingInputs, req.body.id, ownerOf(req), req.body.answers ?? null),
      };
    },
  );

  app.get(
    "/conversations",
    {
      schema: { tags: ["chat"], response: { 200: T.Array(Conversation) } },
      preHandler: app.requirePermission("app:read"),
    },
    async (req) => chatService.listConversations(app.db, getOrgId(req)),
  );

  app.get(
    "/conversations/:id/messages",
    {
      schema: {
        tags: ["chat"],
        params: IdParam,
        response: { 200: T.Array(Message), 404: Problem },
      },
      preHandler: app.requirePermission("app:read"),
    },
    async (req) => chatService.listMessages(app.db, getOrgId(req), req.params.id),
  );

  app.get(
    "/ai-settings",
    {
      schema: { tags: ["chat"], response: { 200: AiSettings } },
      preHandler: app.requirePermission("app:read"),
    },
    async (req) => chatService.getAiSettings(app.db, app.config, getOrgId(req)),
  );

  app.put(
    "/ai-settings",
    {
      schema: {
        tags: ["chat"],
        body: UpdateAiSettings,
        response: { 200: AiSettings, 400: Problem },
      },
      preHandler: app.requirePermission("org:write"),
    },
    async (req) => chatService.updateAiSettings(app.db, app.config, getOrgId(req), req.body),
  );

  // A 1-token Claude round-trip proving the key + model work.
  app.post(
    "/ai-settings/test",
    {
      schema: {
        tags: ["chat"],
        response: {
          200: T.Object({
            ok: T.Boolean(),
            model: T.Optional(T.String()),
            error: T.Optional(T.String()),
          }),
        },
      },
      preHandler: app.requirePermission("org:write"),
    },
    async (req) => chatService.testAiSettings(app.db, app.config, getOrgId(req)),
  );
};
