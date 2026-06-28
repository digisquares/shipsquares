import { useCallback, useEffect, useRef, useState } from "react";

import {
  type AssistantToolEvent,
  actionSummary,
  routeContext,
  suggestedPrompts,
  toolSummary,
} from "../lib/assistant";
import { useRoute } from "../lib/router";
import { createSseParser } from "../lib/sse";

// The in-product assistant (22): a right-side panel over POST /chat. Opens
// from the ⌘K "ask the assistant" path (the ss:assistant event carries the
// query and sends it immediately) or its own trigger. Turns stream as SSE —
// tool activity shows live while the loop runs, then the answer lands with a
// per-turn summary; plain-JSON responses still work as the fallback. An
// unconfigured org gets pointed at Settings instead of a dead spinner.

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  toolEvents?: AssistantToolEvent[];
  usage?: TokenUsage;
}

interface ChatResult {
  conversationId: string;
  text: string;
  toolEvents: AssistantToolEvent[];
  usage?: TokenUsage;
}

/** Compact token count for the per-turn usage line, e.g. "1.3k tokens". */
function tokenLine(u?: TokenUsage): string | null {
  if (!u) return null;
  const total = u.inputTokens + u.outputTokens;
  if (total <= 0) return null;
  const n = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : `${total}`;
  return `${n} tokens`;
}

interface ApprovalReq {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  risk: string;
}

// Structured elicitation (ai-multistep-conversations.md Phase B): the assistant
// asks for missing details via a small form instead of guessing.
interface InputField {
  key: string;
  label: string;
  type: "string" | "integer" | "number" | "boolean" | "enum";
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
  required?: boolean;
  placeholder?: string;
}
interface InputReq {
  id: string;
  reason: string;
  fields: InputField[];
}

/** The form the assistant requested. Owns its field state so the parent panel
 *  stays simple; submits typed answers (or cancels) back to /chat/answer. */
function InputRequestCard({
  req,
  onSubmit,
  onCancel,
}: {
  req: InputReq;
  onSubmit: (answers: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const initial = (f: InputField): string => {
    if (f.default !== undefined) return String(f.default);
    if (f.type === "enum" && f.options?.length) return f.options[0]!.value;
    if (f.type === "boolean") return "false";
    return "";
  };
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(req.fields.map((f) => [f.key, initial(f)])),
  );
  const setField = (key: string, v: string) => setValues((s) => ({ ...s, [key]: v }));
  const isRequired = (f: InputField) => f.required !== false && f.type !== "boolean";
  const missing = req.fields.some((f) => isRequired(f) && !(values[f.key] ?? "").trim());

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const answers: Record<string, unknown> = {};
    for (const f of req.fields) {
      const raw = values[f.key] ?? "";
      if (f.type === "boolean") answers[f.key] = raw === "true";
      else if (raw.trim() === "")
        continue; // optional + empty → omit
      else if (f.type === "integer") answers[f.key] = parseInt(raw, 10);
      else if (f.type === "number") answers[f.key] = Number(raw);
      else answers[f.key] = raw;
    }
    onSubmit(answers);
  };

  return (
    <div className="chat-turn chat-assistant">
      <form className="chat-bubble chat-input-request" onSubmit={submit}>
        <p>{req.reason}</p>
        {req.fields.map((f) => (
          <label key={f.key} className="chat-field">
            <span>
              {f.label}
              {isRequired(f) ? "" : " (optional)"}
            </span>
            {f.type === "enum" ? (
              <select value={values[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)}>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "boolean" ? (
              <input
                type="checkbox"
                checked={values[f.key] === "true"}
                onChange={(e) => setField(f.key, e.target.checked ? "true" : "false")}
              />
            ) : (
              <input
                type={f.type === "integer" || f.type === "number" ? "number" : "text"}
                value={values[f.key] ?? ""}
                placeholder={f.placeholder ?? ""}
                onChange={(e) => setField(f.key, e.target.value)}
              />
            )}
          </label>
        ))}
        <div className="card-actions">
          <button className="btn btn-primary btn-sm" type="submit" disabled={missing}>
            Submit
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// Plan-then-execute (ai-multistep-conversations.md Phase C): the assistant proposes
// an ordered multi-step plan; the user approves it once, then it runs (write steps
// without re-prompting, destructive steps still confirming).
interface PlanStep {
  n?: number;
  description: string;
  tool: string;
  input?: Record<string, unknown>;
}
interface PlanReq {
  id: string;
  goal: string;
  steps: PlanStep[];
}

/** The proposed plan, shown for approval; once approved it stays as a checklist
 *  that ticks off steps as their tools run (matched by tool name). */
function PlanCard({
  plan,
  approved,
  doneTools,
  onApprove,
  onCancel,
}: {
  plan: PlanReq;
  approved: boolean;
  doneTools: Set<string>;
  onApprove: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="chat-turn chat-assistant">
      <div className="chat-bubble chat-plan">
        <p>
          <strong>Plan:</strong> {plan.goal}
        </p>
        <ol className="chat-plan-steps">
          {plan.steps.map((s, i) => (
            <li key={i}>
              {approved && <span aria-hidden="true">{doneTools.has(s.tool) ? "✓ " : "○ "}</span>}
              {s.description} <code className="mono muted">{s.tool}</code>
            </li>
          ))}
        </ol>
        {approved ? (
          <p className="muted">Running…</p>
        ) : (
          <div className="card-actions">
            <button className="btn btn-primary btn-sm" onClick={onApprove}>
              Approve plan
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onCancel}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveTools, setLiveTools] = useState<AssistantToolEvent[]>([]);
  const [liveText, setLiveText] = useState("");
  const [pendingApproval, setPendingApproval] = useState<ApprovalReq | null>(null);
  const [pendingInput, setPendingInput] = useState<InputReq | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PlanReq | null>(null);
  const [planApproved, setPlanApproved] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // Track the current page so send() can pass it as context without re-creating
  // the memoized callback on every navigation.
  const route = useRoute();
  const routeRef = useRef(route);
  routeRef.current = route;

  const send = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setInput("");
      setLiveTools([]);
      setLiveText("");
      setPendingApproval(null);
      setPendingInput(null);
      setPendingPlan(null);
      setPlanApproved(false);
      setTurns((t) => [...t, { role: "user", content: text }]);

      const fail = (content: string) => setTurns((t) => [...t, { role: "assistant", content }]);
      const finishTurn = (d: ChatResult) => {
        setConversationId(d.conversationId);
        setTurns((t) => [
          ...t,
          { role: "assistant", content: d.text, toolEvents: d.toolEvents, usage: d.usage },
        ]);
        setLiveText(""); // the authoritative answer replaces the streamed preview
      };

      const controller = new AbortController();
      abortRef.current = controller;
      const aborted = () => controller.signal.aborted;

      let res: Response;
      try {
        res = await fetch("/api/v1/chat", {
          method: "POST",
          credentials: "include",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
          },
          body: JSON.stringify({
            ...(conversationId ? { conversationId } : {}),
            message: text,
            ...(routeContext(routeRef.current) ? { context: routeContext(routeRef.current)! } : {}),
          }),
        });
      } catch {
        if (aborted()) fail("Stopped.");
        else fail("I couldn't reach the server — check your connection and try again.");
        abortRef.current = null;
        busyRef.current = false;
        setBusy(false);
        return;
      }

      if (res.headers.get("content-type")?.includes("text/event-stream") && res.body) {
        // Streamed turn: tool events render live, `done` lands the answer. A Stop
        // (abort) makes reader.read() reject — caught below and treated as a clean stop.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser();
        let finalized = false;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
              if (ev.event === "tool") {
                setLiveTools((p) => [...p, ev.data as AssistantToolEvent]);
              } else if (ev.event === "delta") {
                setLiveText((p) => p + ((ev.data as { text?: string }).text ?? ""));
              } else if (ev.event === "approval") {
                setPendingApproval(ev.data as ApprovalReq);
              } else if (ev.event === "input_request") {
                setPendingInput(ev.data as InputReq);
              } else if (ev.event === "plan") {
                setPendingPlan(ev.data as PlanReq);
                setPlanApproved(false);
              } else if (ev.event === "done") {
                finalized = true;
                finishTurn(ev.data as ChatResult);
              } else if (ev.event === "error") {
                finalized = true;
                const d = ev.data as { code?: string; message?: string };
                if (d.code === "ai.not_configured") setNotConfigured(true);
                else fail(`That failed: ${d.message ?? "unknown error"}. Try again in a moment.`);
              }
            }
          }
        } catch {
          /* reader aborted/errored — handled by the finalized check below */
        }
        if (!finalized) fail(aborted() ? "Stopped." : "The stream ended unexpectedly — try again.");
      } else {
        // Non-streaming fallback (older server / proxies that buffer SSE).
        const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
        if (res.ok && data) finishTurn(data as ChatResult);
        else if (res.status === 409) setNotConfigured(true);
        else fail(`That failed (HTTP ${res.status}). Try again in a moment.`);
      }

      setLiveTools([]);
      setLiveText("");
      setPendingApproval(null);
      setPendingInput(null);
      setPendingPlan(null);
      setPlanApproved(false);
      abortRef.current = null;
      busyRef.current = false;
      setBusy(false);
    },
    [conversationId],
  );

  // Stop a running turn: aborting the stream closes the connection, which the
  // server detects and uses to halt the tool loop (no more model/tool calls).
  const stop = useCallback(() => abortRef.current?.abort(), []);

  // Approve/decline a proposed write/destructive action; the streaming turn is
  // blocked server-side and resumes once we POST the decision.
  // POST a resolve to the blocked turn; if it fails, restore the card so the user
  // can retry instead of the turn silently hanging until the server timeout.
  const resolve = (url: string, body: unknown, restore: () => void) =>
    fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => {
        if (!r.ok) restore();
      })
      .catch(() => restore());

  const respondApproval = useCallback((approve: boolean) => {
    setPendingApproval((p) => {
      if (p)
        void resolve("/api/v1/chat/approve", { id: p.id, approve }, () => setPendingApproval(p));
      return null;
    });
  }, []);

  // Submit (or cancel) the structured details the assistant asked for; the blocked
  // turn resumes once we POST. Omitting `answers` cancels.
  const respondInput = useCallback((answers: Record<string, unknown> | null) => {
    setPendingInput((p) => {
      if (p)
        void resolve("/api/v1/chat/answer", { id: p.id, ...(answers ? { answers } : {}) }, () =>
          setPendingInput(p),
        );
      return null;
    });
  }, []);

  // Approve/cancel a proposed plan (Phase C). A plan decision is just a boolean, so
  // it reuses /chat/approve. On approve we keep the card as a live checklist; on
  // cancel we dismiss it.
  const respondPlan = useCallback(
    (approve: boolean) => {
      const p = pendingPlan;
      if (!p) return;
      if (approve) setPlanApproved(true);
      else setPendingPlan(null);
      // On a failed POST, undo the optimistic state so the card returns for a retry.
      void resolve("/api/v1/chat/approve", { id: p.id, approve }, () => {
        if (approve) setPlanApproved(false);
        else setPendingPlan(p);
      });
    },
    [pendingPlan],
  );

  // ⌘K hands off here: open the panel and ask the typed query right away.
  useEffect(() => {
    const onAsk = (e: Event) => {
      const query = (e as CustomEvent<{ query?: string }>).detail?.query?.trim();
      setOpen(true);
      if (query) void send(query);
    };
    window.addEventListener("ss:assistant", onAsk);
    return () => window.removeEventListener("ss:assistant", onAsk);
  }, [send]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, busy]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy]);

  // No floating trigger — the topbar Assistant button opens this via the
  // ss:assistant event (P7: FAB absorbed into the topbar).
  if (!open) return null;

  return (
    // Not a modal: a persistent side panel, so the complementary landmark
    // (aside) is the right semantics — role="dialog" is not allowed on it.
    <aside className="chat-panel" aria-label="ShipSquares assistant">
      <header className="chat-head">
        <h2>Assistant</h2>
        <div className="chat-head-actions">
          {turns.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setTurns([]);
                setConversationId(null);
              }}
            >
              New chat
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Close the assistant"
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>
      </header>

      <div className="chat-scroll" ref={scrollRef}>
        {turns.length === 0 && !notConfigured && (
          <div className="chat-hint">
            <p className="muted">
              Ask about your apps, deployments, or logs — the assistant inspects real state and can
              deploy, roll back, and change env for you.
            </p>
            <div className="chat-suggestions">
              {suggestedPrompts(route).map((p) => (
                <button
                  key={p}
                  type="button"
                  className="chat-suggestion"
                  onClick={() => void send(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {notConfigured && (
          <p className="chat-unconfigured">
            AI chat isn&apos;t configured for this org yet. An admin can add a Claude API key under{" "}
            <a href="#/settings">Settings → AI assistant</a>.
          </p>
        )}
        {turns.map((t, i) => {
          const actions = t.toolEvents ? actionSummary(t.toolEvents) : null;
          return (
            <div key={i} className={`chat-turn chat-${t.role}`}>
              <div className="chat-bubble">{t.content}</div>
              {actions && (
                <div className="chat-did">
                  <span className="chat-did-label muted">What I did</span>
                  <ul>
                    {actions.map((a, j) => (
                      <li key={j}>{a.href ? <a href={a.href}>{a.label}</a> : a.label}</li>
                    ))}
                  </ul>
                </div>
              )}
              {t.toolEvents && toolSummary(t.toolEvents) && (
                <div className="chat-tools muted mono">{toolSummary(t.toolEvents)}</div>
              )}
              {tokenLine(t.usage) && (
                <div className="chat-usage muted mono">{tokenLine(t.usage)}</div>
              )}
            </div>
          );
        })}
        {busy && (
          <div className="chat-turn chat-assistant" aria-live="polite">
            <div className={`chat-bubble${liveText ? "" : " chat-thinking"}`}>
              {liveText || (liveTools.length ? "working…" : "thinking…")}
            </div>
            {liveTools.length > 0 && (
              <div className="chat-tools muted mono">{toolSummary(liveTools)}…</div>
            )}
            <button type="button" className="btn btn-ghost btn-sm chat-stop" onClick={stop}>
              Stop
            </button>
          </div>
        )}
        {pendingApproval && (
          <div className="chat-turn chat-assistant">
            <div className="chat-bubble chat-approval">
              <p>
                Approve this <strong>{pendingApproval.risk}</strong> action?
              </p>
              <p className="mono muted">
                {pendingApproval.tool}({JSON.stringify(pendingApproval.input)})
              </p>
              <div className="card-actions">
                <button className="btn btn-primary btn-sm" onClick={() => respondApproval(true)}>
                  Approve
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => respondApproval(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        {pendingInput && (
          <InputRequestCard
            req={pendingInput}
            onSubmit={(answers) => respondInput(answers)}
            onCancel={() => respondInput(null)}
          />
        )}
        {pendingPlan && (
          <PlanCard
            plan={pendingPlan}
            approved={planApproved}
            doneTools={new Set(liveTools.map((e) => e.tool))}
            onApprove={() => respondPlan(true)}
            onCancel={() => respondPlan(false)}
          />
        )}
      </div>

      <form
        className="chat-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the assistant…"
          aria-label="Message the assistant"
          disabled={busy}
        />
        <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}
