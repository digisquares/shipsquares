import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { MCP_TOOLS } from "../mcp/tools.js";
import { SYSTEM_PROMPT } from "../services/chat.service.js";

import { buildAnthropicCreateMessage } from "./anthropic.js";
import { type LoopContentToolUse, runToolLoop } from "./loop.js";

// LIVE Anthropic integration suite — the "test 100% when you have keys" tests.
// They hit the REAL API, so they're EXCLUDED from the default `pnpm test`
// (vitest.config.ts exclude) and SKIP cleanly without a key. Run them with:
//
//     ANTHROPIC_API_KEY=sk-ant-… pnpm test:ai
//     # optional: SS_AI_TEST_MODEL=claude-opus-4-8 to pin the model
//
// They exercise the same code paths the chat service uses
// (buildAnthropicCreateMessage + runToolLoop + the real tool catalog), so a
// green run proves the key, the model ids, our tool schemas, and the agent loop
// all work end-to-end against the live model.

const KEY = process.env.ANTHROPIC_API_KEY;
const d = KEY ? describe : describe.skip;
const MODEL = process.env.SS_AI_TEST_MODEL ?? "claude-sonnet-4-6";

// Current Claude model ids — the validity check catches a deprecation before
// users do. Keep in sync with the models the platform offers.
const MODELS = ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"];

// Guarded so the SDK constructor doesn't throw while the (skipped) suite is
// collected without a key; the dummy is never called when skipped.
const client = KEY ? new Anthropic({ apiKey: KEY }) : ({} as Anthropic);

const toolUses = (content: { type: string }[]): LoopContentToolUse[] =>
  content.filter((c): c is LoopContentToolUse => c.type === "tool_use");

d("AI live · real Anthropic API", () => {
  it("authenticates: a 1-token round-trip returns an assistant message", async () => {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    expect(res.id).toBeTruthy();
    expect(res.role).toBe("assistant");
  }, 30_000);

  it.each(MODELS)(
    "model %s is valid (not deprecated/renamed)",
    async (model) => {
      const res = await client.messages.create({
        model,
        max_tokens: 8,
        messages: [{ role: "user", content: "Reply with: ok" }],
      });
      expect(res.stop_reason).toBeTruthy();
      expect(res.model).toContain(model.split("-").slice(0, 2).join("-")); // e.g. "claude-sonnet"
    },
    30_000,
  );

  it("the live model selects a tool from our catalog for a fitting prompt", async () => {
    const createMessage = buildAnthropicCreateMessage(client, {
      model: MODEL,
      system: SYSTEM_PROMPT,
      maxTokens: 1024,
      tools: MCP_TOOLS,
    });
    const res = await createMessage([{ role: "user", content: "List the apps in my org." }]);
    expect(toolUses(res.content).map((t) => t.name)).toContain("list_apps");
  }, 30_000);

  it("runs the full tool loop end-to-end (tool result → grounded final answer)", async () => {
    const createMessage = buildAnthropicCreateMessage(client, {
      model: MODEL,
      system: SYSTEM_PROMPT,
      maxTokens: 1024,
      tools: MCP_TOOLS,
    });
    const result = await runToolLoop(
      {
        createMessage,
        execTool: async (name) =>
          name === "list_apps"
            ? {
                text: JSON.stringify([
                  { id: "app_demo1", name: "checkout", status: "running" },
                  { id: "app_demo2", name: "marketing", status: "stopped" },
                ]),
              }
            : { text: "[]" },
      },
      [{ role: "user", content: "Which of my apps are running? Name them." }],
    );
    expect(result.toolEvents.map((e) => e.tool)).toContain("list_apps");
    expect(result.turns).toBeGreaterThanOrEqual(2);
    expect(result.text.toLowerCase()).toContain("checkout"); // grounded in the tool result
  }, 60_000);

  it("does not invent state — surfaces a not-found honestly instead of hallucinating", async () => {
    const createMessage = buildAnthropicCreateMessage(client, {
      model: MODEL,
      system: SYSTEM_PROMPT,
      maxTokens: 1024,
      tools: MCP_TOOLS,
    });
    const result = await runToolLoop(
      {
        createMessage,
        execTool: async () => ({ text: "HTTP 404 app not found", isError: true }),
      },
      [{ role: "user", content: "What is the status of app app_doesnotexist_xyz?" }],
    );
    expect(result.toolEvents.length).toBeGreaterThanOrEqual(1); // tried a tool, didn't invent
    expect(result.text.toLowerCase()).toMatch(
      /not found|doesn't exist|does not exist|no such|couldn't find|could not find|unable to find/,
    );
  }, 60_000);
});
