import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../lib/api";
import { signOut } from "../lib/auth";
import { type Command, paletteResults } from "../lib/commands";
import { go } from "../lib/router";
import { toggleTheme } from "../lib/theme";

interface AppLite {
  id: string;
  name: string;
  branch?: string;
}

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
const SHORTCUT_LABEL = isMac ? "⌘K" : "Ctrl K";

// Global ⌘K / Ctrl+K command palette (25-design-system.md). Navigates and acts;
// an unmatched query offers the AI assistant (wired in a later iteration via the
// `ss:assistant` event). Accessible (combobox/listbox, focus restore, keyboard
// operable) and honors prefers-reduced-motion via CSS.
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [apps, setApps] = useState<AppLite[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
    const el = restoreFocusRef.current;
    // The captured trigger may have unmounted while the palette was open —
    // fall back to the page body's first focusable landmark instead of <body>.
    if (el?.isConnected) el.focus();
    else document.querySelector<HTMLElement>("a, button, input, [tabindex]")?.focus();
  }, []);

  // Toggle on ⌘K / Ctrl+K from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // On open: remember focus, focus the input, and load apps for "Open <app>".
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    void api.get<{ data: AppLite[] }>("/api/v1/apps").then((r) => {
      if (r.ok && r.data?.data) setApps(r.data.data);
    });
    return () => window.clearTimeout(t);
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: "nav-dashboard",
        title: "Go to Dashboard",
        group: "Navigate",
        keywords: ["home", "apps", "overview"],
        run: () => go("#/"),
      },
      {
        id: "nav-settings",
        title: "Go to Settings",
        group: "Navigate",
        keywords: ["git", "connections", "account", "github"],
        run: () => go("#/settings"),
      },
      {
        id: "nav-mail",
        title: "Go to Email",
        group: "Navigate",
        keywords: ["mail", "email", "mailbox", "domain", "inbox", "smtp", "dns"],
        run: () => go("#/mail"),
      },
      {
        id: "act-add-mail-domain",
        title: "Add mail domain",
        group: "Actions",
        keywords: ["email", "mail", "domain", "dkim", "mx"],
        run: () => go("#/mail"),
      },
      {
        id: "act-new-app",
        title: "New app",
        group: "Actions",
        keywords: ["create", "add", "deploy"],
        run: () => {
          go("#/");
          window.dispatchEvent(new CustomEvent("ss:new-app"));
        },
      },
      {
        id: "act-theme",
        title: "Toggle theme (dark / light)",
        group: "Actions",
        keywords: ["dark", "light", "appearance", "color"],
        run: () => void toggleTheme(),
      },
      {
        id: "act-signout",
        title: "Sign out",
        group: "Actions",
        keywords: ["logout", "log out", "exit"],
        run: () => void signOut().then(() => location.reload()),
      },
    ];
    for (const a of apps) {
      list.push({
        id: `app-${a.id}`,
        title: `Open ${a.name}`,
        subtitle: a.branch ?? a.id,
        group: "Apps",
        keywords: [a.name, a.id],
        run: () => go(`#/apps/${a.id}`),
      });
    }
    return list;
  }, [apps]);

  const results = useMemo(() => paletteResults(commands, query), [commands, query]);
  const itemCount = results.commands.length + (results.askAssistant ? 1 : 0);
  const askIndex = results.askAssistant ? results.commands.length : -1;

  // Keep the active index within range as results change.
  useEffect(() => {
    setActive((i) => (itemCount === 0 ? 0 : Math.min(i, itemCount - 1)));
  }, [itemCount]);

  const runIndex = useCallback(
    (i: number) => {
      if (i === askIndex) {
        // The ChatPanel listens for this, opens, and asks the query right away.
        window.dispatchEvent(new CustomEvent("ss:assistant", { detail: { query } }));
        close();
        return;
      }
      const c = results.commands[i];
      if (!c) return;
      close();
      c.run();
    },
    [askIndex, results, query, close],
  );

  if (!open) {
    return (
      <button
        type="button"
        className="cmdk-trigger"
        aria-label="Open command palette"
        onClick={() => setOpen(true)}
      >
        <span className="cmdk-kbd">{SHORTCUT_LABEL}</span>
        <span>Command palette</span>
      </button>
    );
  }

  return (
    <div className="cmdk-overlay" role="presentation" onMouseDown={close}>
      <div
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="cmdk-input"
          role="combobox"
          aria-expanded
          aria-controls="cmdk-list"
          aria-activedescendant={itemCount ? `cmdk-opt-${active}` : undefined}
          aria-label="Search commands or ask the assistant"
          placeholder="Search commands or ask the assistant…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
              e.preventDefault();
              setActive((i) => (itemCount ? (i + 1) % itemCount : 0));
            } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
              e.preventDefault();
              setActive((i) => (itemCount ? (i - 1 + itemCount) % itemCount : 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              runIndex(active);
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        />
        <ul id="cmdk-list" className="cmdk-list" role="listbox" aria-label="Commands">
          {results.commands.map((c, i) => (
            <li
              key={c.id}
              id={`cmdk-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className="cmdk-item"
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                runIndex(i);
              }}
            >
              <span className="cmdk-item-title">{c.title}</span>
              {c.subtitle ? <span className="cmdk-item-sub mono">{c.subtitle}</span> : null}
              <span className="cmdk-item-group">{c.group}</span>
            </li>
          ))}
          {results.askAssistant ? (
            <li
              id={`cmdk-opt-${askIndex}`}
              role="option"
              aria-selected={active === askIndex}
              className="cmdk-item cmdk-item-ask"
              onMouseEnter={() => setActive(askIndex)}
              onMouseDown={(e) => {
                e.preventDefault();
                runIndex(askIndex);
              }}
            >
              <span className="cmdk-item-title">Ask the assistant: “{query}”</span>
              <span className="cmdk-item-group">AI</span>
            </li>
          ) : null}
        </ul>
        <div className="cmdk-foot">
          <span>
            <span className="cmdk-kbd">↑↓</span> navigate
          </span>
          <span>
            <span className="cmdk-kbd">↵</span> run
          </span>
          <span>
            <span className="cmdk-kbd">esc</span> close
          </span>
        </div>
      </div>
    </div>
  );
}
