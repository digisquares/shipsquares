import type Anthropic from "@anthropic-ai/sdk";

import { TOOL_CATEGORIES, TOOL_CATEGORY_NAMES } from "../mcp/tools.js";

// Dynamic tool selection (ai-assistant-roadmap.md). A small, cheap model (Haiku)
// maps the user's intent → the relevant tool categories, so the main agent carries
// only those categories' tools instead of the whole catalog. Coarse (category-level)
// on purpose: more forgiving than per-tool picking, and one cheap round-trip. On any
// error or empty result it returns ALL categories — it never narrows to nothing.

export const PICKER_MODEL = "claude-haiku-4-5-20251001";
const PICKER_MAX_TOKENS = 256;

const SELECT_CATEGORIES_TOOL = {
  name: "select_categories",
  description: "Select the tool categories needed to handle the request.",
  input_schema: {
    type: "object" as const,
    properties: {
      categories: { type: "array", items: { type: "string", enum: TOOL_CATEGORY_NAMES } },
    },
    required: ["categories"],
  },
};

/** Ask Haiku which tool categories the intent needs. Returns category names (a
 *  subset of TOOL_CATEGORY_NAMES); falls back to all categories on any problem. */
export async function pickCategories(client: Anthropic, intent: string): Promise<string[]> {
  const list = TOOL_CATEGORIES.map((c) => `- ${c.name}: ${c.description}`).join("\n");
  try {
    const res = await client.messages.create({
      model: PICKER_MODEL,
      max_tokens: PICKER_MAX_TOKENS,
      system:
        "You route a request for a self-hosted PaaS assistant to the tool categories needed " +
        `to handle it. Categories:\n${list}\n\nCall select_categories with every category ` +
        "plausibly needed (prefer few; when unsure, include more — never return an empty list).",
      tools: [SELECT_CATEGORIES_TOOL],
      tool_choice: { type: "tool", name: "select_categories" },
      messages: [{ role: "user", content: intent }],
    });
    const use = res.content.find((c) => c.type === "tool_use");
    const picked = use ? (use.input as { categories?: unknown }).categories : undefined;
    const names = Array.isArray(picked)
      ? picked.filter((x): x is string => typeof x === "string" && TOOL_CATEGORY_NAMES.includes(x))
      : [];
    return names.length ? names : TOOL_CATEGORY_NAMES;
  } catch {
    return TOOL_CATEGORY_NAMES; // never break the turn over tool selection
  }
}
