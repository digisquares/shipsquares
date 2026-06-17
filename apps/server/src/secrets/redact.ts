// Build a redactor from a set of secret values (11). Used by the deploy log
// writer (06 records.ts) so resolved secret values never reach deployment_logs
// or the live stream, even if a build tool prints them. Longest-first so a
// secret that contains another is masked whole; ignores ultra-short values
// (< 4 chars) to avoid over-masking common tokens.
export function makeRedactor(
  redactSet: ReadonlySet<string>,
  mask = "***",
): (line: string) => string {
  const needles = [...redactSet].filter((s) => s.length >= 4).sort((a, b) => b.length - a.length);
  if (needles.length === 0) return (line) => line;
  return (line) => needles.reduce((acc, secret) => acc.split(secret).join(mask), line);
}
