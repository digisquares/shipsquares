// Serialize resolved env for a compose project's .env file (11 → 07): compose
// interpolates ${VAR} from it and services can env_file it. Values ride one
// line each — anything with a newline (PEM keys…) cannot be represented in
// .env and is skipped; callers log the skip so the gap is visible.
export function formatDotEnv(values: Record<string, string>): {
  content: string;
  skipped: string[];
} {
  const lines: string[] = [];
  const skipped: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    if (v.includes("\n")) {
      skipped.push(k);
      continue;
    }
    lines.push(`${k}=${v}`);
  }
  return { content: lines.length ? `${lines.join("\n")}\n` : "", skipped };
}
