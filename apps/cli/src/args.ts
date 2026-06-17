// Tiny, dependency-free argv parser. `valueFlags` names the flags that take a
// value (`--tail 100`); every other `--flag` is a boolean. Anything else is a
// positional. Kept pure so it's fully unit-tested.

export interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[], valueFlags: string[] = []): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const tok = rest[i] ?? "";
    if (tok.startsWith("--")) {
      const key = tok.slice(2);
      if (valueFlags.includes(key)) {
        flags[key] = rest[i + 1] ?? "";
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(tok);
    }
  }
  return { command, positionals, flags };
}
