import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

import { wsUrl } from "../lib/ws";

import "@xterm/xterm/css/xterm.css";

// Interactive container console (21-logs-and-console.md) over /ws/console:
// open → validated server-side (target charset, shell allowlist), data frames
// stream both ways, resize follows the terminal fit. The transport is
// pipe-based today (no TTY line editing); xterm still gives a workable shell.
export function Console({ target }: { target: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      theme: { background: "#0b0e14" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    const ws = new WebSocket(wsUrl("/api/v1/ws/console"));
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "open", target, shell: "sh" }));
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    interface ConsoleMsg {
      type?: string;
      data?: string;
      code?: number | string;
    }
    ws.onmessage = (e) => {
      let msg: ConsoleMsg;
      try {
        msg = JSON.parse(String(e.data)) as ConsoleMsg;
      } catch {
        return;
      }
      if (msg.type === "opened") setStatus("open");
      else if (msg.type === "data" && typeof msg.data === "string") term.write(msg.data);
      else if (msg.type === "exit") {
        term.write(`\r\n[process exited (${String(msg.code)})]\r\n`);
        setStatus("closed");
      } else if (msg.type === "error") {
        term.write(`\r\n[error: ${String(msg.code)}]\r\n`);
        setStatus("error");
      }
    };
    ws.onclose = () => setStatus((s) => (s === "open" || s === "connecting" ? "closed" : s));
    ws.onerror = () => setStatus("error");

    const sub = term.onData((data) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "input", data }));
    });
    const onResize = () => {
      fit.fit();
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      sub.dispose();
      ws.close();
      term.dispose();
    };
  }, [target]);

  return (
    <div>
      <div ref={hostRef} className="console-host" aria-label="Container console" />
      {status === "closed" ? <p className="muted">Console session ended.</p> : null}
      {status === "error" ? (
        <p className="field-error">Console unavailable — is the container running?</p>
      ) : null}
    </div>
  );
}
