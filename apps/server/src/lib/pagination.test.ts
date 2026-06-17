import { AppError } from "@ss/shared";
import { describe, expect, it } from "vitest";

import { buildPage, decodeCursor, encodeCursor } from "./pagination.js";

describe("cursor pagination", () => {
  it("round-trips a cursor through opaque base64url", () => {
    const cursor = { lastId: "app_123", lastSortKey: "2026-01-01T00:00:00.000Z" };
    const encoded = encodeCursor(cursor);
    expect(encoded).not.toContain("app_123");
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it("rejects a tampered cursor with pagination.invalid_cursor (400)", () => {
    let caught: unknown;
    try {
      decodeCursor("%%%not-valid%%%");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("pagination.invalid_cursor");
    expect((caught as AppError).status).toBe(400);
  });

  it("buildPage derives nextCursor/hasMore from a limit+1 fetch", () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({
      id: `app_${i}`,
      createdAt: `2026-01-0${i + 1}`,
    }));
    const full = buildPage(rows, 3, (r) => r.createdAt);
    expect(full.data).toHaveLength(3);
    expect(full.page.hasMore).toBe(true);
    expect(full.page.nextCursor).not.toBeNull();

    const partial = buildPage(rows.slice(0, 2), 3, (r) => r.createdAt);
    expect(partial.data).toHaveLength(2);
    expect(partial.page.hasMore).toBe(false);
    expect(partial.page.nextCursor).toBeNull();
  });
});
