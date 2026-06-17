import { describe, expect, it } from "vitest";

import { clearQueries, pushQuery, recentQueries } from "./history";

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as Storage;
}

describe("query history", () => {
  it("pushes most-recent-first, dedupes, and ignores blanks", () => {
    const s = memStorage();
    pushQuery("select 1", s);
    pushQuery("select 2", s);
    pushQuery("  ", s);
    pushQuery("select 1", s); // moves to front, no duplicate
    expect(recentQueries(s)).toEqual(["select 1", "select 2"]);
  });

  it("caps the list at 20", () => {
    const s = memStorage();
    for (let i = 0; i < 30; i += 1) pushQuery(`select ${i}`, s);
    const list = recentQueries(s);
    expect(list).toHaveLength(20);
    expect(list[0]).toBe("select 29");
  });

  it("clears history", () => {
    const s = memStorage();
    pushQuery("select 1", s);
    clearQueries(s);
    expect(recentQueries(s)).toEqual([]);
  });

  it("returns [] on malformed storage", () => {
    const s = memStorage();
    s.setItem("ss.dbstudio.sqlhistory", "{not json");
    expect(recentQueries(s)).toEqual([]);
  });
});
