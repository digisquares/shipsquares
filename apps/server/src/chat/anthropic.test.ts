import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import { buildAnthropicCreateMessage } from "./anthropic.js";

// The live API path lives in ai-live.test.ts (gated on a real key). This covers the
// request SHAPE the binding builds — prompt caching, metadata, and text streaming —
// against a mocked SDK so it runs in CI.

interface Captured {
  model: string;
  max_tokens: number;
  system: Array<{ cache_control?: { type: string } }>;
  tools?: Array<{ cache_control?: { type: string } }>;
  metadata?: { user_id: string };
  thinking?: { type: string; budget_tokens: number };
}
interface Opts {
  headers?: Record<string, string>;
}

function mockClient(finalMsg: unknown) {
  let captured: Captured | undefined;
  let capturedOpts: Opts | undefined;
  const textCbs: Array<(d: string) => void> = [];
  const stream = {
    on(event: string, cb: (d: string) => void): void {
      if (event === "text") textCbs.push(cb);
    },
    async finalMessage() {
      for (const cb of textCbs) cb("tok"); // simulate a streamed delta
      return finalMsg;
    },
  };
  const client = {
    messages: {
      stream: vi.fn((p: Captured, opts?: Opts) => {
        captured = p;
        capturedOpts = opts;
        return stream;
      }),
    },
  } as unknown as Anthropic;
  return { client, get: () => captured, getOpts: () => capturedOpts };
}

describe("buildAnthropicCreateMessage", () => {
  it("streams deltas, caches system + last tool, sets metadata, maps usage", async () => {
    const finalMsg = {
      content: [{ type: "text", text: "hi" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 2,
      },
    };
    const { client, get } = mockClient(finalMsg);
    const deltas: string[] = [];
    const createMessage = buildAnthropicCreateMessage(client, {
      model: "claude-test",
      system: "SYSTEM",
      maxTokens: 100,
      tools: [
        { name: "a", description: "A", inputSchema: { type: "object" } },
        { name: "b", description: "B", inputSchema: { type: "object" } },
      ],
      onText: (d) => deltas.push(d),
      userId: "user_1",
    });

    const res = await createMessage([{ role: "user", content: "hi" }] as never);
    const captured = get()!;

    expect(res.content).toEqual(finalMsg.content); // same content blocks → loop unchanged
    expect(res.stop_reason).toBe("end_turn");
    expect(res.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
    });
    expect(deltas).toEqual(["tok"]); // streamed text reached onText
    expect(captured.system[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect(captured.tools?.[0]?.cache_control).toBeUndefined(); // only the last tool
    expect(captured.tools?.[1]?.cache_control).toEqual({ type: "ephemeral" });
    expect(captured.metadata).toEqual({ user_id: "user_1" });
    expect(captured.model).toBe("claude-test");
  });

  it("omits tools + metadata when there are none / no user", async () => {
    const { client, get } = mockClient({
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const createMessage = buildAnthropicCreateMessage(client, {
      model: "m",
      system: "S",
      maxTokens: 10,
      tools: [],
    });
    await createMessage([{ role: "user", content: "x" }] as never);
    const captured = get()!;
    expect(captured.tools).toBeUndefined();
    expect(captured.metadata).toBeUndefined();
    expect(captured.thinking).toBeUndefined(); // off by default
  });

  it("enables extended thinking with a budget under max_tokens + the beta header", async () => {
    const { client, get, getOpts } = mockClient({
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const createMessage = buildAnthropicCreateMessage(client, {
      model: "m",
      system: "S",
      maxTokens: 4096,
      tools: [],
      thinking: true,
    });
    await createMessage([{ role: "user", content: "x" }] as never);
    const captured = get()!;
    expect(captured.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    // max_tokens must exceed the thinking budget and still leave room for the answer
    expect(captured.max_tokens).toBe(4096 + 2048);
    expect(captured.max_tokens).toBeGreaterThan(captured.thinking!.budget_tokens);
    expect(getOpts()?.headers?.["anthropic-beta"]).toContain("interleaved-thinking");
  });
});
