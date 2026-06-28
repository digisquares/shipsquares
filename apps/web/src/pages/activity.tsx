import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "../components/empty-state";
import { Page } from "../components/page";
import { SkeletonRows } from "../components/skeleton";
import { StatusPill } from "../components/status-pill";
import { api } from "../lib/api";
import { pageTitle } from "../lib/page-title";
import { relativeTime } from "../lib/time";

interface ActivityRow {
  id: string;
  appId: string;
  appName: string;
  status: string;
  trigger: string;
  commitAfter: string | null;
  queuedAt: string;
}

// Activity (docs/web-ui/01, §3 Platform — new route). The org-wide deployment
// feed across every app; deploy-only for v1 (the audit trail folds in later,
// open question §11.5).
export function Activity() {
  const [items, setItems] = useState<ActivityRow[] | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const r = await api.get<{ data: ActivityRow[] }>("/api/v1/deployments");
    if (r.ok) {
      setItems(r.data.data);
      setNote("");
    } else {
      setItems([]);
      setNote(`Activity API responded ${r.status}.`);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
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
          <SkeletonRows count={4} />
        ) : items.length > 0 ? (
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
        ) : (
          <EmptyState
            title="No activity yet"
            description={note || "Deployments across your apps will show up here as they happen."}
          />
        )}
      </section>
    </Page>
  );
}
