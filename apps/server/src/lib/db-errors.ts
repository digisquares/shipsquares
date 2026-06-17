/**
 * Postgres unique-violation (SQLSTATE 23505) → surface as a 409. Walks the
 * `cause` chain because drizzle wraps the underlying postgres.js error, so the
 * `code` lives on `err.cause` (or deeper), not the top-level error.
 */
export function isUniqueViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  let e: unknown = err;
  while (e != null && typeof e === "object" && !seen.has(e)) {
    seen.add(e);
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
