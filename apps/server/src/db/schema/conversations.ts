import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import { messageRole } from "./enums.js";
import { organizations } from "./organizations.js";

// Chatbot conversation persistence (22-chatbot-agent.md): one row per
// conversation, org-scoped; messages keep a strict per-conversation ordinal so
// tool-call/result events replay in order.

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(), // conv_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgIdx: index("conversations_org_idx").on(t.organizationId, t.updatedAt) }),
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(), // msg_…
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(), // 0..n within the conversation
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    // Tool calls/results emitted during this turn, in execution order
    // (Agent SDK events; shape owned by the 22 chat service).
    toolEvents: jsonb("tool_events").$type<Record<string, unknown>[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ convIdx: index("messages_conv_idx").on(t.conversationId, t.ordinal) }),
);

// Per-org assistant memory (ai-assistant-roadmap.md): durable facts/preferences the
// user asks the assistant to remember ("my prod app is api", naming conventions),
// keyed for upsert and auto-injected into the system prompt each turn. Org-scoped;
// capped in the service so the injected block stays small.
export const aiMemories = pgTable(
  "ai_memories",
  {
    id: text("id").primaryKey(), // mem_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgKeyUq: uniqueIndex("ai_memories_org_key_uq").on(t.organizationId, t.key) }),
);
