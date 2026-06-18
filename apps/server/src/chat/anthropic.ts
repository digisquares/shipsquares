import Anthropic from "@anthropic-ai/sdk";

import type { LoopMessage, LoopResponse } from "./loop.js";

// The runtime Anthropic binding for the tool loop (22-chatbot-agent.md),
// extracted so the chat service AND the live test suite drive the SAME code
// path. The loop stays provider-agnostic (it only sees createMessage); this maps
// our plain-JSON-Schema tool catalog onto the SDK and returns the final message
// (structurally identical content blocks) as a LoopResponse.

/** Minimal tool shape — `McpTool` is structurally assignable, so the catalog
 *  passes straight through. */
export interface AnthropicToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CreateMessageConfig {
  model: string;
  system: string;
  maxTokens: number;
  tools: AnthropicToolDef[];
  /** Streams assistant text deltas as they arrive (token-level streaming). */
  onText?: (delta: string) => void;
  /** Opaque id for Anthropic's abuse monitoring (`metadata.user_id`). */
  userId?: string;
  /** Opt-in extended thinking — the model reasons before/between tool calls. */
  thinking?: boolean;
}

// Reasoning budget when extended thinking is on. max_tokens must exceed it and
// also leave room for the visible answer, so we add it on top of maxTokens.
const THINKING_BUDGET = 2048;
// Lets thinking blocks interleave with tool calls across the loop (otherwise the
// model only thinks before its first response). Extended thinking itself is GA.
const INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14";

export function buildAnthropicCreateMessage(
  client: Anthropic,
  config: CreateMessageConfig,
): (messages: LoopMessage[]) => Promise<LoopResponse> {
  // Prompt caching (cost/latency): the system prompt + tool catalog are a large,
  // identical prefix re-sent on every user turn AND every tool-loop round. Marking
  // the system block + the last tool `ephemeral` caches that whole prefix (~5-min
  // TTL) so only the growing message tail is re-processed — up to ~90% cheaper and
  // ~85% lower latency on a cache hit, and a no-op otherwise.
  const tools = config.tools.map((t, i) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
    ...(i === config.tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: config.system, cache_control: { type: "ephemeral" } },
  ];

  return async (messages) => {
    // Stream so text reaches the client token-by-token; finalMessage() yields the
    // same complete Message that .create() would, so the tool loop is unchanged.
    // With thinking on, finalMessage's content carries the thinking blocks, which
    // the loop echoes verbatim on the next turn — preserving their signatures.
    const stream = client.messages.stream(
      {
        model: config.model,
        max_tokens: config.thinking ? config.maxTokens + THINKING_BUDGET : config.maxTokens,
        system,
        ...(tools.length ? { tools } : {}),
        ...(config.thinking
          ? { thinking: { type: "enabled", budget_tokens: THINKING_BUDGET } }
          : {}),
        ...(config.userId ? { metadata: { user_id: config.userId } } : {}),
        messages: messages as Anthropic.MessageParam[],
      },
      config.thinking ? { headers: { "anthropic-beta": INTERLEAVED_THINKING_BETA } } : undefined,
    );
    if (config.onText) {
      const onText = config.onText;
      stream.on("text", (delta) => onText(delta));
    }
    const final = await stream.finalMessage();
    const u = final.usage;
    return {
      ...(final as unknown as LoopResponse),
      usage: {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      },
    };
  };
}
