import { AppError } from "@ss/shared";

// Cursor pagination over `(created_at, id)` — stable under inserts, unlike
// offset, for the constantly-growing deployment/log lists (04-api-openapi.md).
export interface Cursor {
  lastId: string;
  lastSortKey: string;
}

export interface PageResult<T> {
  data: T[];
  page: { nextCursor: string | null; hasMore: boolean };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(value: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new AppError("invalid cursor", { status: 400, code: "pagination.invalid_cursor" });
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.lastId !== "string" ||
    typeof parsed.lastSortKey !== "string"
  ) {
    throw new AppError("invalid cursor", { status: 400, code: "pagination.invalid_cursor" });
  }
  return { lastId: parsed.lastId, lastSortKey: parsed.lastSortKey };
}

/**
 * Turn a `limit + 1` fetch into a page: if more rows came back than requested,
 * there's a next page and the extra row is dropped; the cursor points past the
 * last returned row.
 */
export function buildPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  sortKey: (row: T) => string,
): PageResult<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ lastId: last.id, lastSortKey: sortKey(last) }) : null;
  return { data, page: { nextCursor, hasMore } };
}
