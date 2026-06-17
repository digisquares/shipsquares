import { useCallback, useEffect, useRef, useState } from "react";

import { type AssistantToolEvent, toolSummary } from "../lib/assistant";
import { createSseParser } from "../lib/sse";

// The in-product assistant (22): a right-side panel over POST /chat. Opens
// from the ⌘K "ask the assistant" path (the ss:assistant event carries the
// query and sends it immediately) or its own trigger. Turns stream as SSE —
// tool activity shows live while the loop runs, then the answer lands with a
// per-turn summary; plain-JSON responses still work as the fallback. An
// unconfigured org gets pointed at Settings instead of a dead spinner.

interface Turn {
  role: "user" | "assistant";
  content: string;
  toolEvents?: AssistantToolEvent[];
}

interface ChatResult {
  conversationId: string;
  text: string;
  toolEvents: AssistantToolEvent[];
}

export function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveTools, setLiveTools] = useState<AssistantToolEvent[]>([]);
  const [notConfigured, setNotConfigured] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  const send = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setInput("");
      setLiveTools([]);
      setTurns((t) => [...t, { role: "user", content: text }]);

      const fail = (content: string) => setTurns((t) => [...t, { role: "assistant", content }]);
      const finishTurn = (d: ChatResult) => {
        setConversationId(d.conversationId);
        setTurns((t) => [...t, { role: "assistant", content: d.text, toolEvents: d.toolEvents }]);
      };

      let res: Response;
      try {
        res = await fetch("/api/v1/chat", {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
          },
          body: JSON.stringify({ ...(conversationId ? { conversationId } : {}), message: text }),
        });
      } catch {
        fail("I couldn't reach the server — check your connection and try again.");
        busyRef.current = false;
        setBusy(false);
        return;
      }

      if (res.headers.get("content-type")?.includes("text/event-stream") && res.body) {
        // Streamed turn: tool events render live, `done` lands the answer.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser();
        let finalized = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
            if (ev.event === "tool") {
              setLiveTools((p) => [...p, ev.data as AssistantToolEvent]);
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
        if (!finalized) fail("The stream ended unexpectedly — try again.");
      } else {
        // Non-streaming fallback (older server / proxies that buffer SSE).
        const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
        if (res.ok && data) finishTurn(data as ChatResult);
        else if (res.status === 409) setNotConfigured(true);
        else fail(`That failed (HTTP ${res.status}). Try again in a moment.`);
      }

      setLiveTools([]);
      busyRef.current = false;
      setBusy(false);
    },
    [conversationId],
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

  if (!open) {
    return (
      <button
        type="button"
        className="chat-trigger"
        aria-label="Open the assistant"
        onClick={() => setOpen(true)}
      >
        Assistant
      </button>
    );
  }

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
          <p className="muted chat-hint">
            Ask about your apps, deployments, or logs — the assistant inspects real state and can
            deploy, roll back, and change env for you.
          </p>
        )}
        {notConfigured && (
          <p className="chat-unconfigured">
            AI chat isn&apos;t configured for this org yet. An admin can add a Claude API key under{" "}
            <a href="#/settings">Settings → AI assistant</a>.
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`chat-turn chat-${t.role}`}>
            <div className="chat-bubble">{t.content}</div>
            {t.toolEvents && toolSummary(t.toolEvents) && (
              <div className="chat-tools muted mono">{toolSummary(t.toolEvents)}</div>
            )}
          </div>
        ))}
        {busy && (
          <div className="chat-turn chat-assistant" aria-live="polite">
            <div className="chat-bubble chat-thinking">
              {liveTools.length ? "working…" : "thinking…"}
            </div>
            {liveTools.length > 0 && (
              <div className="chat-tools muted mono">{toolSummary(liveTools)}…</div>
            )}
          </div>
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
