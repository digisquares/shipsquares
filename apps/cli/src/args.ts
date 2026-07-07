// Tiny, dependency-free argv parser. `valueFlags` names the flags that take a
// value (`--tail 100`); every other `--flag` is a boolean. Anything else is a
// positional. Kept pure so it's fully unit-tested.

export interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

// Value-taking flags for the CLI (every other `--flag` is a boolean). Shared by
// main.ts and the tests so there's one source of truth — `timeout` was missing
// here, which silently dropped `ss deploy --wait --timeout N` to the default.
export const VALUE_FLAGS = ["url", "email", "password", "tail", "limit", "timeout"];

export function parseArgs(argv: string[], valueFlags: string[] = []): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const tok = rest[i] ?? "";
    if (tok.startsWith("--")) {
      const body = tok.slice(2);
      const eq = body.indexOf("=");
      if (eq !== -1) {
        // `--key=value` inline form (was previously read as a boolean flag named
        // "key=value", silently dropping the value).
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (valueFlags.includes(body)) {
        const next = rest[i + 1];
        // Only consume a following token as the value if it isn't itself a flag —
        // `--tail --json` must not set tail="--json" and swallow --json.
        if (next !== undefined && !next.startsWith("--")) {
          flags[body] = next;
          i += 1;
        } else {
          flags[body] = "";
        }
      } else {
        flags[body] = true;
      }
    } else {
      positionals.push(tok);
    }
  }
  return { command, positionals, flags };
}
