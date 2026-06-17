import { and, type SQL, eq, lt, or } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { type Cursor, decodeCursor } from "../lib/pagination.js";

// Canonical impl lives in lib/db-errors.ts (cause-chain walking — drizzle wraps
// the postgres.js error); re-exported here for the existing service imports.
export { isUniqueViolation } from "../lib/db-errors.js";

/**
 * Keyset (cursor) predicate for a list ordered by `(createdAt DESC, id DESC)`:
 * rows strictly after the cursor. Pairs with `buildPage` in lib/pagination.ts.
 */
export function afterCursor(
  createdAt: PgColumn,
  id: PgColumn,
  cursor: string | undefined,
): SQL | undefined {
  if (!cursor) return undefined;
  const c: Cursor = decodeCursor(cursor);
  const at = new Date(c.lastSortKey);
  return or(lt(createdAt, at), and(eq(createdAt, at), lt(id, c.lastId)));
}
