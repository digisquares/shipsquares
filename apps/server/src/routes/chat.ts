import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as chatService from "../services/chat.service.js";

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
  },
  { additionalProperties: false },
);

const ChatResult = T.Object({
  conversationId: T.String(),
  text: T.String(),
  toolEvents: T.Array(ToolEvent),
});

const AiSettings = T.Object({
  enabled: T.Boolean(),
  configured: T.Boolean(),
  keySource: T.Union([T.Literal("org"), T.Literal("platform"), T.Literal("none")]),
  keyHint: T.Union([T.String(), T.Null()]),
  model: T.String(),
});

const UpdateAiSettings = T.Object(
  {
    apiKey: T.Optional(T.String({ minLength: 8, maxLength: 256 })),
    model: T.Optional(T.String({ minLength: 1, maxLength: 64 })),
    enabled: T.Optional(T.Boolean()),
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
      const send = (event: string, data: unknown) =>
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      try {
        const result = await chatService.chatTurn(app, req, req.body, (e) => send("tool", e));
        send("done", result);
      } catch (err) {
        const e = err as { message?: string; code?: string };
        send("error", { message: e.message ?? "chat failed", code: e.code ?? "chat.failed" });
      } finally {
        reply.raw.end();
      }
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
