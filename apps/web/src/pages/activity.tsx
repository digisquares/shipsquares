import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { Page } from "../components/page";
import { SkeletonRows } from "../components/skeleton";
import { StatusPill } from "../components/status-pill";
import { api } from "../lib/api";
import { pageTitle } from "../lib/page-title";
import { relativeTime } from "../lib/time";
import { describeError } from "../lib/use-resource";

interface ActivityRow {
  id: string;
  appId: string;
  appName: string;
  status: string;
  trigger: string;
  commitAfter: string | null;
  queuedAt: string;
}

interface DeploymentsPage {
  data: ActivityRow[];
  page: { nextCursor: string | null; hasMore: boolean };
}

const PAGE_SIZE = 25;

// Activity (docs/web-ui/01, §3 Platform). The org-wide deployment feed across
// every app. It grows without bound, so it's cursor-paginated (docs/platform-
// review 03-ui-ux §7): a page at a time with a "Load more" that appends via the
// API's keyset cursor, rather than rendering the whole history at once.
export function Activity() {
  const [items, setItems] = useState<ActivityRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (mode: "reset" | "more") => {
      if (mode === "more") setLoadingMore(true);
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
      const from = mode === "more" ? cursor : null; // reset always starts at the head
      if (from) qs.set("cursor", from);
      const r = await api.get<DeploymentsPage>(`/api/v1/deployments?${qs.toString()}`);
      if (mode === "more") setLoadingMore(false);
      if (r.ok) {
        setItems((prev) => (mode === "reset" || !prev ? r.data.data : [...prev, ...r.data.data]));
        setCursor(r.data.page.nextCursor);
        setHasMore(r.data.page.hasMore);
        setError(null);
      } else {
        setError(describeError(r.status));
      }
    },
    [cursor],
  );

  useEffect(() => {
    void load("reset");
  }, []);
  useEffect(() => {
    document.title = pageTitle("Activity");
  }, []);

  return (
    <Page title="Activity" subtitle="Recent deployments across all your apps.">
      <section className="card">
        <div className="card-head">
          <h2>Recent deployments</h2>
        </div>
        {items === null ? (
          error ? (
            <ErrorState
              title="Couldn't load activity"
              message={error}
              onRetry={() => void load("reset")}
            />
          ) : (
            <SkeletonRows count={4} />
          )
        ) : items.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description="Deployments across your apps will show up here as they happen."
          />
        ) : (
          <>
            <ul className="app-list">
              {items.map((d) => (
                <li key={d.id} className="app-row">
                  <a className="app-name app-link" href={`#/apps/${d.appId}`}>
                    {d.appName}
                  </a>
                  <StatusPill status={d.status} />
                  <span className="muted mono">{d.trigger}</span>
                  <span className="mono">{d.commitAfter?.slice(0, 7) ?? "—"}</span>
                  <span className="muted app-id" title={new Date(d.queuedAt).toLocaleString()}>
                    {relativeTime(d.queuedAt)}
                  </span>
                </li>
              ))}
            </ul>
            {error ? (
              <p className="field-error">
                Couldn&apos;t load more.{" "}
                <button type="button" className="link-btn" onClick={() => void load("more")}>
                  Retry
                </button>
              </p>
            ) : hasMore ? (
              <div className="load-more">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={loadingMore}
                  onClick={() => void load("more")}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </Page>
  );
}
