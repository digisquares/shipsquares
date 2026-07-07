import { useCallback, useEffect, useRef, useState } from "react";

import { type ApiResult } from "./api";

// The one data-fetch contract for pages (docs/platform-review/03-ui-ux.md §1).
// Before this, every list page hand-rolled `load()` + a full re-fetch and, on
// failure, set the list to `[]` with an error string folded into the empty
// state — so an outage rendered as "No X yet" with no way to retry. `useResource`
// makes the three states explicit (loading / error / data) and hands back a
// stable `reload` for an ErrorState Retry button. A load that fails sets `error`
// and leaves the last-known `data` intact (never a spurious empty). Cancel on
// unmount avoids a state-set-after-unmount when the user navigates away mid-fetch.

export interface Resource<T> {
  data: T | null;
  loading: boolean;
  /** null while OK; a short human message when the last load failed. */
  error: string | null;
  /** Re-run the fetch (the Retry action, and post-mutation refresh). */
  reload: () => void;
}

/** Map a transport/HTTP failure to a short, human message for the ErrorState. */
export function describeError(status: number): string {
  if (status === 0) return "Couldn't reach the server — check your connection.";
  if (status === 403) return "You don't have access to this.";
  if (status === 404) return "This resource no longer exists.";
  if (status >= 500) return `The server responded ${status}. Try again in a moment.`;
  return `The request failed (${status}).`;
}

export function useResource<T>(
  fetcher: () => Promise<ApiResult<T>>,
  deps: unknown[] = [],
): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Always call the latest fetcher (pages define it inline, so it changes every
  // render) without re-subscribing the effect on every render — the effect keys
  // on `deps`, the ref keeps `reload` current.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const aliveRef = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const r = await fetcherRef.current();
    if (!aliveRef.current) return;
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else {
      setError(describeError(r.status));
    }
    setLoading(false);
  }, []);

  // Re-run when the caller's deps change (default []: mount + manual reload).
  // deps is a rest-style dependency list, intentionally spread.
  useEffect(() => {
    aliveRef.current = true;
    void reload();
    return () => {
      aliveRef.current = false;
    };
  }, deps);

  return { data, loading, error, reload: () => void reload() };
}
