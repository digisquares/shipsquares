import { useEffect, useMemo, useRef, useState } from "react";

import { boundedTail, firstErrorIndex, isErrorLine, matchLine, parseAnsi } from "../lib/logs";

export interface LogViewerLine {
  line: string;
  stream?: string;
  key?: string | number;
}

interface Props {
  lines: LogViewerLine[];
  emptyText?: string;
  /** Bounded buffer: max lines rendered (keeps the DOM light on huge logs). */
  max?: number;
}

// The signature live-log component (25-design-system.md): ANSI color, sticky
// "follow", in-view search, jump-to-error, and copy. Streams come from the
// caller (WebSocket); this renders + interacts. role="log" gives an implicit
// polite live region; scrolling is instant so it's reduced-motion friendly.
export function LogViewer({ lines, emptyText = "No logs.", max = 5000 }: Props) {
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const bounded = useMemo(() => boundedTail(lines, max), [lines, max]);
  const filtered = useMemo(
    () => (query.trim() ? bounded.filter((l) => matchLine(l.line, query)) : bounded),
    [bounded, query],
  );
  const errorIdx = useMemo(() => firstErrorIndex(filtered), [filtered]);

  // Stick to the bottom while following.
  useEffect(() => {
    const el = scrollRef.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [filtered, follow]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== follow) setFollow(atBottom);
  };

  const jumpToError = () => {
    const el = scrollRef.current;
    if (errorIdx < 0 || !el) return;
    setFollow(false);
    el.querySelector<HTMLElement>(`[data-logidx="${errorIdx}"]`)?.scrollIntoView({
      block: "center",
    });
  };

  const copyAll = () => {
    void navigator.clipboard?.writeText(filtered.map((l) => l.line).join("\n"));
  };

  return (
    <div className="logview">
      <div className="logview-bar">
        <input
          className="logview-search"
          type="search"
          placeholder="Search logs…"
          aria-label="Search logs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim() ? (
          <span className="muted logview-count">
            {filtered.length} match{filtered.length === 1 ? "" : "es"}
          </span>
        ) : null}
        <span className="logview-spacer" />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={jumpToError}
          disabled={errorIdx < 0}
          title={errorIdx < 0 ? "No errors" : "Jump to first error"}
        >
          Jump to error
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={copyAll} title="Copy logs">
          Copy
        </button>
        <label className="logview-follow">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Follow
        </label>
      </div>
      <div
        className="log-console"
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-label="Log output"
      >
        {filtered.length === 0 ? (
          <div className="muted">{query.trim() ? "No matching lines." : emptyText}</div>
        ) : (
          filtered.map((l, i) => (
            <div
              key={l.key ?? i}
              data-logidx={i}
              className={`log-line log-${l.stream ?? "stdout"}${isErrorLine(l) ? " log-line-error" : ""}`}
            >
              {parseAnsi(l.line).map((sp, j) => (
                <span key={j} className={sp.classes.join(" ")}>
                  {sp.text}
                </span>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
