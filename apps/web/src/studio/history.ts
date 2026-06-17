// Recent-query history for the SQL runner (database-studio/05, R(db).3),
// persisted in localStorage. Most-recent-first, deduped, capped. Pure over an
// injected Storage so it's unit-tested without a real browser.

const KEY = "ss.dbstudio.sqlhistory";
const MAX = 20;

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function recentQueries(storage: Storage | null = store()): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed.filter((x) => typeof x === "string") as string[]) : [];
  } catch {
    return [];
  }
}

export function pushQuery(sql: string, storage: Storage | null = store()): string[] {
  const q = sql.trim();
  if (!q) return recentQueries(storage);
  const list = [q, ...recentQueries(storage).filter((x) => x !== q)].slice(0, MAX);
  if (storage) {
    try {
      storage.setItem(KEY, JSON.stringify(list));
    } catch {
      /* quota / unavailable — history is best-effort */
    }
  }
  return list;
}

export function clearQueries(storage: Storage | null = store()): void {
  if (!storage) return;
  try {
    storage.removeItem(KEY);
  } catch {
    /* best-effort */
  }
}
