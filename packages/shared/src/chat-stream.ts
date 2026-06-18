// The AI assistant streaming protocol — the ONE contract every client implements
// (web, native mobile, CLI). The assistant ENGINE is entirely server-side (the tool
// loop, MCP catalog, approval gate, memory, knowledge); a client is a thin UI over
// `POST /chat` (Server-Sent Events) plus the `POST /chat/approve` / `POST /chat/answer`
// handshake. These types are the canonical shapes of the SSE events and the request
// bodies, so the server's emit and every client stay in lockstep. See
// docs/ai-assistant-api.md for the full protocol.

export type ChatToolRisk = "read" | "write" | "destructive";

/** One tool the assistant ran during a turn (streamed live, and persisted on the
 *  final result in execution order). */
export interface ChatToolEvent {
  tool: string;
  input: Record<string, unknown>;
  result: string;
  isError?: boolean;
}

/** A write/destructive action awaiting the user's approval. Resolve with
 *  `POST /chat/approve` { id, approve }. */
export interface ChatApprovalEvent {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  risk: ChatToolRisk;
}

export type ChatInputFieldType = "string" | "integer" | "number" | "boolean" | "enum";

export interface ChatInputField {
  key: string;
  label: string;
  type: ChatInputFieldType;
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
  required?: boolean;
  placeholder?: string;
}

/** A structured request for missing details (render a form). Resolve with
 *  `POST /chat/answer` { id, answers } (omit `answers` to cancel). */
export interface ChatInputRequestEvent {
  id: string;
  reason: string;
  fields: ChatInputField[];
}

export interface ChatPlanStep {
  n?: number;
  description: string;
  tool: string;
  input?: Record<string, unknown>;
}

/** A proposed multi-step plan awaiting approval. Reuses `POST /chat/approve`
 *  { id, approve }; on approve, the plan's write steps run without re-prompting. */
export interface ChatPlanEvent {
  id: string;
  goal: string;
  steps: ChatPlanStep[];
}

/** Token usage for a turn, summed across the tool-loop's model calls (input/output
 *  plus prompt-cache read/write) — lets clients show cost/observability. */
export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** The authoritative turn result (also the body of the non-streaming JSON response). */
export interface ChatTurnResult {
  conversationId: string;
  text: string;
  toolEvents: ChatToolEvent[];
  usage?: ChatUsage;
}

export interface ChatErrorEvent {
  message: string;
  code: string;
}

/** The SSE event stream of a `POST /chat` turn (Accept: text/event-stream), as a
 *  discriminated union of (event name → data payload). A turn emits zero or more
 *  `tool`/`delta` events, may pause on `approval`/`input_request`/`plan`, and ends
 *  with exactly one `done` or `error`. */
export type ChatStreamEvent =
  | { event: "tool"; data: ChatToolEvent }
  | { event: "delta"; data: { text: string } }
  | { event: "approval"; data: ChatApprovalEvent }
  | { event: "input_request"; data: ChatInputRequestEvent }
  | { event: "plan"; data: ChatPlanEvent }
  | { event: "done"; data: ChatTurnResult }
  | { event: "error"; data: ChatErrorEvent };

export type ChatStreamEventName = ChatStreamEvent["event"];

// ── Request bodies (client → server) ─────────────────────────────────────────

export interface ChatTurnRequest {
  conversationId?: string;
  message: string;
  /** Optional page context, e.g. "viewing app app_123" — injected into the system
   *  prompt so "this app" resolves. Sanitized server-side. */
  context?: string;
}

export interface ChatApproveRequest {
  id: string;
  approve: boolean;
}

export interface ChatAnswerRequest {
  id: string;
  /** The collected field answers; omit to cancel the request. */
  answers?: Record<string, unknown>;
}
