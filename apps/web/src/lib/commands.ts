// Command-palette model + fuzzy matcher (25-design-system.md, principle 3:
// "keyboard-first" — ⌘K navigates and acts). Pure, dependency-free logic so it
// is unit-testable in isolation; the React UI lives in
// components/command-palette.tsx.

export interface Command {
  id: string;
  title: string;
  subtitle?: string;
  /** Display bucket: "Navigate" | "Actions" | "Apps" | … */
  group: string;
  /** Extra terms the fuzzy matcher should also match against. */
  keywords?: string[];
  run: () => void;
}

export interface PaletteResults {
  /** Commands that matched `query`, best first. */
  commands: Command[];
  /** True when a non-empty query matched nothing — offer the AI assistant. */
  askAssistant: boolean;
}

// Score a query against a single string. Higher is better; a negative result
// means "no match". Ranking guarantee (per the design-system test plan):
//   exact (1000) > prefix (≥500) > subsequence (1–400) > no-match (-1).
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (q === "") return 0;
  const t = text.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return Math.max(500, 800 - (t.length - q.length));

  // Subsequence: every char of `q` appears in `t`, in order.
  let ti = 0;
  let firstIdx = -1;
  for (const ch of q) {
    let found = -1;
    while (ti < t.length) {
      const cur = t[ti];
      ti += 1;
      if (cur === ch) {
        found = ti - 1;
        break;
      }
    }
    if (found === -1) return -1;
    if (firstIdx === -1) firstIdx = found;
  }
  // Prefer compact matches that start early.
  const span = ti - firstIdx;
  return Math.max(1, 400 - Math.min(399, firstIdx + span));
}

// Best score for a command across its title and keywords.
export function scoreCommand(command: Command, query: string): number {
  let best = -1;
  for (const field of [command.title, ...(command.keywords ?? [])]) {
    best = Math.max(best, fuzzyScore(query, field));
  }
  return best;
}

// Filter to matching commands, best score first; a stable index tiebreak keeps
// declaration order for equal scores. An empty query returns everything as-is.
export function rankCommands(commands: Command[], query: string): Command[] {
  if (query.trim() === "") return commands;
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, query) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.command);
}

export function paletteResults(commands: Command[], query: string): PaletteResults {
  const matched = rankCommands(commands, query);
  return { commands: matched, askAssistant: query.trim() !== "" && matched.length === 0 };
}
