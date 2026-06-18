import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import { TOOL_CATEGORY_NAMES } from "../mcp/tools.js";

import { pickCategories } from "./tool-picker.js";

function clientReturning(content: unknown[]): Anthropic {
  return { messages: { create: vi.fn(async () => ({ content })) } } as unknown as Anthropic;
}

describe("pickCategories", () => {
  it("returns the categories the model selects, dropping unknown ones", async () => {
    const client = clientReturning([
      {
        type: "tool_use",
        name: "select_categories",
        input: { categories: ["databases", "nope", "servers"] },
      },
    ]);
    expect(await pickCategories(client, "show my db tables")).toEqual(["databases", "servers"]);
  });

  it("falls back to ALL categories when the model selects none", async () => {
    const client = clientReturning([
      { type: "tool_use", name: "select_categories", input: { categories: [] } },
    ]);
    expect(await pickCategories(client, "hello")).toEqual(TOOL_CATEGORY_NAMES);
  });

  it("falls back to ALL categories on an API error (never breaks the turn)", async () => {
    const client = {
      messages: {
        create: vi.fn(async () => {
          throw new Error("rate limited");
        }),
      },
    } as unknown as Anthropic;
    expect(await pickCategories(client, "deploy api")).toEqual(TOOL_CATEGORY_NAMES);
  });
});
