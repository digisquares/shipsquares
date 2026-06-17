import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
