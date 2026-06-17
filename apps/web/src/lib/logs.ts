// Log-viewer core (25-design-system.md, "the centerpiece"): ANSI SGR parsing,
// a bounded tail buffer, error detection / jump-to-error, and search. Pure and
// dependency-free so it is unit-testable; the React UI is components/log-viewer.

export interface RawLine {
  line: string;
  stream?: string;
}

export interface AnsiSpan {
  text: string;
  classes: string[];
}

// Built from a runtime-created escape char so eslint's no-control-regex doesn't
// trip on a literal \x1b in the source.
const ESC = String.fromCharCode(27);
const ANSI_SOURCE = ESC + "\\[([0-9;]*)m";
const ANSI_GLOBAL = new RegExp(ANSI_SOURCE, "g");

// SGR foreground codes → our terminal palette classes (the console is dark in
// both themes). Bright variants share the standard hue except bright-black.
const SGR_FG: Record<number, string> = {
  30: "ansi-black",
  31: "ansi-red",
  32: "ansi-green",
  33: "ansi-yellow",
  34: "ansi-blue",
  35: "ansi-magenta",
  36: "ansi-cyan",
  37: "ansi-white",
  90: "ansi-bright-black",
  91: "ansi-red",
  92: "ansi-green",
  93: "ansi-yellow",
  94: "ansi-blue",
  95: "ansi-magenta",
  96: "ansi-cyan",
  97: "ansi-white",
};

const ERROR_RE = /\b(error|fatal|exception|failed|failure|panic|traceback)\b/i;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_GLOBAL, "");
}

export function parseAnsi(s: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let fg: string | null = null;
  let bold = false;
  let last = 0;
  const re = new RegExp(ANSI_SOURCE, "g");
  const push = (text: string) => {
    if (!text) return;
    const classes: string[] = [];
    if (bold) classes.push("ansi-bold");
    if (fg) classes.push(fg);
    spans.push({ text, classes });
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    push(s.slice(last, m.index));
    last = re.lastIndex;
    const codes = m[1] === "" ? [0] : m[1]!.split(";").map((x) => parseInt(x, 10));
    for (const code of codes) {
      const cls = SGR_FG[code];
      if (code === 0) {
        fg = null;
        bold = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 22) {
        bold = false;
      } else if (code === 39) {
        fg = null;
      } else if (cls) {
        fg = cls;
      }
    }
  }
  push(s.slice(last));
  return spans.length ? spans : [{ text: s, classes: [] }];
}

export function isErrorLine(l: RawLine): boolean {
  return l.stream === "stderr" || ERROR_RE.test(stripAnsi(l.line));
}

// Index of the first error-ish line, or -1. Drives "jump to first error".
export function firstErrorIndex(lines: RawLine[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (isErrorLine(lines[i]!)) return i;
  }
  return -1;
}

// Bounded buffer: keep only the last `max` lines (replay-safe, DOM-safe).
export function boundedTail<T>(lines: T[], max: number): T[] {
  return lines.length > max ? lines.slice(lines.length - max) : lines;
}

export function matchLine(line: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || stripAnsi(line).toLowerCase().includes(q);
}
