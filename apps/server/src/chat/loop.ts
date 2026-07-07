// The chat tool loop (22-chatbot-agent.md): provider-agnostic Claude tool-use
// orchestration with injected createMessage/execTool, so the whole control
// flow is unit-tested without the Anthropic SDK. The chat service binds the
// real client + the MCP tool catalog executed in-process (the /mcp pattern).

import type { ChatUsage } from "@ss/shared";

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
  /** Token usage for this model call (the adapter fills it; absent in tests). */
  usage?: ChatUsage;
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
  ): Promise<{ text: string; isError?: boolean; trusted?: boolean }>;
  /** invoked as each tool finishes — the streaming transport's progress feed */
  onToolEvent?: (event: ToolEvent) => void;
  /** Effective risk tier of a tool (ai-assistant-roadmap.md). "read" runs freely;
   *  write/destructive must be approved. Absent ⇒ everything treated as read. */
  riskOf?: (name: string) => "read" | "write" | "destructive";
  /** Human-in-the-loop gate for write/destructive tools. Resolves true to run,
   *  false to decline. Absent on a transport that can't prompt ⇒ such tools are
   *  declined (never silently executed). */
  requestApproval?: (req: {
    tool: string;
    input: Record<string, unknown>;
    risk: "read" | "write" | "destructive";
  }) => Promise<boolean>;
  /** Collect structured input from the user mid-turn for the request_input
   *  meta-tool (ai-multistep-conversations.md Phase B). Receives the model's raw
   *  request (reason + fields), resolves the user's answers keyed by field, or
   *  null if cancelled. Absent ⇒ the model is told to ask in chat instead. */
  requestInput?: (input: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  /** Show the user a proposed multi-step plan and get their go-ahead before
   *  executing it (ai-multistep-conversations.md Phase C). Resolves true to run the
   *  plan (its write steps then auto-run; destructive steps still confirm), false to
   *  cancel. Absent ⇒ the model proceeds conservatively, confirming each action. */
  requestPlan?: (plan: Record<string, unknown>) => Promise<boolean>;
  /** Cooperative cancellation: checked before each model call. When it returns true
   *  (e.g. the client disconnected / hit Stop), the loop stops and returns what it
   *  has so far instead of running more model/tool calls. */
  shouldAbort?: () => boolean;
}

export interface ChatLoopResult {
  text: string;
  toolEvents: ToolEvent[];
  turns: number;
  /** Token usage summed across the turn's model calls. */
  usage: ChatUsage;
}

/** Protocol name of the structured-input meta-tool (ai-multistep-conversations.md
 *  Phase B). The model calls it to collect missing details from the user; the loop
 *  intercepts it (no REST call) and the transport renders a form. The tool's
 *  user-facing schema/description lives in chat/elicitation.ts. */
export const REQUEST_INPUT_TOOL_NAME = "request_input";

/** Protocol name of the plan meta-tool (ai-multistep-conversations.md Phase C).
 *  The model proposes an ordered multi-step plan; the loop intercepts it, the
 *  transport shows it for approval, and once approved the plan's write steps run
 *  without re-prompting (destructive steps still confirm). Tool def: chat/planning.ts. */
export const PROPOSE_PLAN_TOOL_NAME = "propose_plan";

const DEFAULT_MAX_TURNS = 8;
// Hard ceiling on the turn budget once a plan is approved — generous enough for a
// sizeable plan (~2 turns/step) yet bounded so an over-eager plan can't run away.
const PLAN_TURN_CAP = 40;

/** Anthropic requires the first message to be `user`. A history WINDOW (the last
 *  N persisted turns) can begin with an assistant message — which the API
 *  rejects (400). Drop leading non-user messages so the window always opens on a
 *  user turn. Pure. */
export function dropLeadingAssistant(history: LoopMessage[]): LoopMessage[] {
  let i = 0;
  while (i < history.length && history[i]?.role !== "user") i += 1;
  return history.slice(i);
}

/** Rough token estimate for a message (~3.5 chars/token, conservative). The
 *  content is either a string (loaded history) or content blocks. */
function estimateTokens(m: LoopMessage): number {
  const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
  return Math.ceil(text.length / 3.5);
}

// Tool output (logs, env values, DB rows, user-/third-party-supplied text) is
// UNTRUSTED data that re-enters the model as a tool_result. Two cheap defenses
// (ai-assistant-roadmap.md; prompt injection is OWASP LLM01): (1) cap each
// result so one huge log can't blow the context or bury the user's prompt, and
// (2) fence it in a clearly-delimited block the system prompt tells the model to
// treat as DATA, never as instructions. The approval gate is the backstop — even
// a perfectly-crafted "delete everything" in a log can't auto-run a write tool.
const MAX_TOOL_RESULT_CHARS = 8000;

/** Fence + size-cap a tool result before it re-enters the model. Pure. The raw,
 *  unfenced text is still surfaced to the user via `ToolEvent.result`; only the
 *  copy fed back to the model is wrapped.
 *
 *  Tool output is the most attacker-reachable channel (deploy/build logs, DB
 *  rows), so a literal `</untrusted-tool-output>` inside the body would break out
 *  of the fence and land as apparent system context. We defang the fence token
 *  (both directions) before wrapping — the same reason `sanitizeForPrompt` strips
 *  angle brackets from stored memory/activity/page-context. Newlines are kept so
 *  multi-line logs stay readable to the model. */
export function fenceToolResult(text: string, max = MAX_TOOL_RESULT_CHARS): string {
  const capped =
    text.length > max ? `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]` : text;
  const body = capped.replace(/<\/?untrusted-tool-output>/gi, "[fence-marker-removed]");
  return `<untrusted-tool-output>\n${body}\n</untrusted-tool-output>`;
}

/** Keep the most recent messages within an approximate token budget — robustness
 *  beyond the fixed message-count window, so a few large turns can't blow the
 *  context. Walks newest→oldest, always keeps at least the latest message, and
 *  preserves chronological order. Pure (local estimate; no API round-trip). */
export function trimToTokenBudget(history: LoopMessage[], budget: number): LoopMessage[] {
  const kept: LoopMessage[] = [];
  let total = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i]!;
    const t = estimateTokens(m);
    if (kept.length && total + t > budget) break;
    total += t;
    kept.push(m);
  }
  return kept.reverse();
}

export async function runToolLoop(
  deps: ChatLoopDeps,
  history: LoopMessage[],
  maxTurns = DEFAULT_MAX_TURNS,
): Promise<ChatLoopResult> {
  const messages: LoopMessage[] = [...history];
  const toolEvents: ToolEvent[] = [];
  let lastText = "";
  // Phase C plan state: approving a plan grants a bounded number of auto-runs PER
  // write tool — one per write step in the plan — so consent is to the plan's steps,
  // not a blanket "this tool is now approved" for the rest of the turn. Destructive
  // steps are never granted (they always re-confirm). An approved plan also raises
  // the turn budget so a multi-step plan isn't cut off mid-execution.
  const approvedWriteRuns = new Map<string, number>();
  let budget = maxTurns;
  const usage: ChatUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  const addUsage = (u?: ChatUsage) => {
    if (!u) return;
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
    usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + (u.cacheReadTokens ?? 0);
    usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + (u.cacheWriteTokens ?? 0);
  };

  for (let turn = 1; turn <= budget; turn += 1) {
    // Cooperative cancellation: stop before another model call if the client left.
    if (deps.shouldAbort?.()) {
      return { text: lastText || "(stopped)", toolEvents, turns: turn - 1, usage };
    }
    const res = await deps.createMessage(messages);
    addUsage(res.usage);
    const textBlocks = res.content.filter((c): c is LoopContentText => c.type === "text");
    if (textBlocks.length) lastText = textBlocks.map((c) => c.text).join("\n");
    const toolUses = res.content.filter((c): c is LoopContentToolUse => c.type === "tool_use");

    if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
      return { text: lastText, toolEvents, turns: turn, usage };
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
      // Structured-input meta-tool (ai-multistep-conversations.md Phase B): the
      // model calls request_input to gather missing details. There's no REST call —
      // the transport renders a form and returns the answers. Handled before the
      // approval gate (it has no side effects). The answers are the user's own
      // trusted input, so they're fed back unfenced.
      if (use.name === REQUEST_INPUT_TOOL_NAME) {
        const answers = deps.requestInput ? await deps.requestInput(use.input) : null;
        const itext =
          answers === null
            ? deps.requestInput
              ? "The user cancelled the input request."
              : "Input collection isn't available on this transport; ask the user in chat instead."
            : JSON.stringify(answers);
        const ievent: ToolEvent = {
          tool: use.name,
          input: use.input,
          result: itext,
          ...(answers === null ? { isError: true } : {}),
        };
        toolEvents.push(ievent);
        deps.onToolEvent?.(ievent);
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: itext,
          ...(answers === null ? { is_error: true } : {}),
        });
        continue;
      }

      // Plan meta-tool (ai-multistep-conversations.md Phase C): the model proposes
      // an ordered multi-step plan; the transport shows it for approval. On approval,
      // the plan's write steps join the auto-run set (no per-step re-prompt) and the
      // turn budget grows to fit; destructive steps still confirm individually.
      if (use.name === PROPOSE_PLAN_TOOL_NAME) {
        const approved = deps.requestPlan ? await deps.requestPlan(use.input) : false;
        const steps = Array.isArray((use.input as { steps?: unknown }).steps)
          ? (use.input as { steps: unknown[] }).steps
          : [];
        let ptext: string;
        if (approved) {
          for (const s of steps) {
            const tool = (s as { tool?: unknown }).tool;
            if (typeof tool === "string" && (deps.riskOf?.(tool) ?? "read") === "write") {
              // one auto-run granted per write step (bounded consent, not blanket)
              approvedWriteRuns.set(tool, (approvedWriteRuns.get(tool) ?? 0) + 1);
            }
          }
          // ~2 turns/step (a step may need a read then the write) + the final answer.
          budget = Math.min(PLAN_TURN_CAP, Math.max(budget, turn + steps.length * 2 + 2));
          ptext =
            "Plan approved. Execute the steps in order — you don't need to re-request approval " +
            "for the plan's write steps, but destructive steps still require individual " +
            "confirmation. Report each result before the next, and stop if one fails.";
        } else {
          ptext = deps.requestPlan
            ? "The user did not approve the plan. Ask what they'd like to change instead of proceeding."
            : "Plan approval isn't available on this transport; proceed conservatively, confirming each action.";
        }
        const planErr = deps.requestPlan === undefined ? false : !approved;
        const pevent: ToolEvent = {
          tool: use.name,
          input: use.input,
          result: ptext,
          ...(planErr ? { isError: true } : {}),
        };
        toolEvents.push(pevent);
        deps.onToolEvent?.(pevent);
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: ptext,
          ...(planErr ? { is_error: true } : {}),
        });
        continue;
      }

      let text: string;
      let isError = false;
      let trusted = false; // in-process reference data (e.g. guided_template) isn't fenced

      // Approval gate: a write/destructive tool runs only with the user's consent —
      // unless the user already approved it as a write step of a plan (Phase C), in
      // which case a bounded number of auto-runs (one per approved step) is consumed.
      const risk = deps.riskOf?.(use.name) ?? "read";
      const planAllowance = approvedWriteRuns.get(use.name) ?? 0;
      const planApproved = risk === "write" && planAllowance > 0;
      if (planApproved) approvedWriteRuns.set(use.name, planAllowance - 1);
      if (risk !== "read" && !planApproved) {
        const approved = deps.requestApproval
          ? await deps.requestApproval({ tool: use.name, input: use.input, risk })
          : false;
        if (!approved) {
          text = deps.requestApproval
            ? "The user declined this action."
            : "This action needs confirmation and isn't available on this transport.";
          const declined: ToolEvent = {
            tool: use.name,
            input: use.input,
            result: text,
            isError: true,
          };
          toolEvents.push(declined);
          deps.onToolEvent?.(declined);
          results.push({ type: "tool_result", tool_use_id: use.id, content: text, is_error: true });
          continue;
        }
      }

      try {
        const out = await deps.execTool(use.name, use.input);
        text = out.text;
        isError = out.isError === true;
        trusted = out.trusted === true;
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
        // Untrusted external output is fenced + capped; trusted in-process reference
        // data (guided_template) the model itself requested is passed through.
        content: trusted ? text : fenceToolResult(text),
        ...(isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: results });
  }

  return {
    text: lastText || `(stopped after ${budget} tool turns without a final answer)`,
    toolEvents,
    turns: budget,
    usage,
  };
}
