import Anthropic from "@anthropic-ai/sdk";

import type { LoopMessage, LoopResponse } from "./loop.js";

// The runtime Anthropic binding for the tool loop (22-chatbot-agent.md),
// extracted so the chat service AND the live test suite drive the SAME code
// path. The loop stays provider-agnostic (it only sees createMessage); this maps
// our plain-JSON-Schema tool catalog onto the SDK and casts the SDK response
// (structurally identical content blocks) back to LoopResponse.

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
}

export function buildAnthropicCreateMessage(
  client: Anthropic,
  config: CreateMessageConfig,
): (messages: LoopMessage[]) => Promise<LoopResponse> {
  const tools = config.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
  }));
  return async (messages) =>
    (await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system: config.system,
      ...(tools.length ? { tools } : {}),
      messages: messages as Anthropic.MessageParam[],
    })) as unknown as LoopResponse;
}
