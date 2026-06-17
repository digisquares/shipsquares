// The chat tool loop (22-chatbot-agent.md): provider-agnostic Claude tool-use
// orchestration with injected createMessage/execTool, so the whole control
// flow is unit-tested without the Anthropic SDK. The chat service binds the
// real client + the MCP tool catalog executed in-process (the /mcp pattern).

export interface LoopContentText {
  type: "text";
  text: string;
}
export interface LoopContentToolUse {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export type LoopContent = LoopContentText | LoopContentToolUse;

export interface LoopResponse {
  content: LoopContent[];
  stop_reason: string | null;
}

export interface LoopMessage {
  role: "user" | "assistant";
  content: unknown;
}

export interface ToolEvent {
  tool: string;
  input: Record<string, unknown>;
  result: string;
  isError?: boolean;
}

export interface ChatLoopDeps {
  createMessage(messages: LoopMessage[]): Promise<LoopResponse>;
  execTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ text: string; isError?: boolean }>;
  /** invoked as each tool finishes — the streaming transport's progress feed */
  onToolEvent?: (event: ToolEvent) => void;
}

export interface ChatLoopResult {
  text: string;
  toolEvents: ToolEvent[];
  turns: number;
}

const DEFAULT_MAX_TURNS = 8;

/** Anthropic requires the first message to be `user`. A history WINDOW (the last
 *  N persisted turns) can begin with an assistant message — which the API
 *  rejects (400). Drop leading non-user messages so the window always opens on a
 *  user turn. Pure. */
export function dropLeadingAssistant(history: LoopMessage[]): LoopMessage[] {
  let i = 0;
  while (i < history.length && history[i]?.role !== "user") i += 1;
  return history.slice(i);
}

export async function runToolLoop(
  deps: ChatLoopDeps,
  history: LoopMessage[],
  maxTurns = DEFAULT_MAX_TURNS,
): Promise<ChatLoopResult> {
  const messages: LoopMessage[] = [...history];
  const toolEvents: ToolEvent[] = [];
  let lastText = "";

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const res = await deps.createMessage(messages);
    const textBlocks = res.content.filter((c): c is LoopContentText => c.type === "text");
    if (textBlocks.length) lastText = textBlocks.map((c) => c.text).join("\n");
    const toolUses = res.content.filter((c): c is LoopContentToolUse => c.type === "tool_use");

    if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
      return { text: lastText, toolEvents, turns: turn };
    }

    // Echo the assistant turn, run every requested tool, answer with results.
    messages.push({ role: "assistant", content: res.content });
    const results: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }> = [];
    for (const use of toolUses) {
      let text: string;
      let isError = false;
      try {
        const out = await deps.execTool(use.name, use.input);
        text = out.text;
        isError = out.isError === true;
      } catch (err) {
        text = err instanceof Error ? err.message : String(err);
        isError = true;
      }
      const event: ToolEvent = {
        tool: use.name,
        input: use.input,
        result: text,
        ...(isError ? { isError } : {}),
      };
      toolEvents.push(event);
      deps.onToolEvent?.(event);
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: text,
        ...(isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: results });
  }

  return {
    text: lastText || `(stopped after ${maxTurns} tool turns without a final answer)`,
    toolEvents,
    turns: maxTurns,
  };
}
