import { useCallback, useEffect, useRef, useState } from "react";

import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { Page } from "../components/page";
import { SkeletonRows } from "../components/skeleton";
import { StatusPill } from "../components/status-pill";
import { api } from "../lib/api";
import { confirm } from "../lib/confirm";
import { pageTitle } from "../lib/page-title";
import { toast } from "../lib/toast";
import { useResource } from "../lib/use-resource";

// Catalog (17): browse the vendored templates, one-click install, manage
// installed services. Installs are async server-side — the list polls while
// anything is still "installing".

interface CatalogItem {
  slug: string;
  slogan: string;
  category: string | null;
  tags: string[];
}

interface InstalledService {
  id: string;
  slug: string;
  name: string;
  status: string;
  error: string | null;
}

const SHOWN_CAP = 60;

export function Catalog() {
  const {
    data: items,
    loading,
    error,
    reload,
  } = useResource(() => api.get<CatalogItem[]>("/api/v1/catalog"));
  const [installed, setInstalled] = useState<InstalledService[]>([]);
  const [query, setQuery] = useState("");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const loadInstalled = useCallback(async () => {
    const r = await api.get<InstalledService[]>("/api/v1/catalog-services");
    if (r.ok && r.data) setInstalled(r.data);
  }, []);

  useEffect(() => {
    document.title = pageTitle("Catalog");
    void loadInstalled();
  }, [loadInstalled]);

  // poll while any install is in flight
  useEffect(() => {
    const installing = installed.some((s) => s.status === "installing");
    if (installing && pollRef.current === null) {
      pollRef.current = window.setInterval(() => void loadInstalled(), 4000);
    } else if (!installing && pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [installed, loadInstalled]);

  async function install(slug: string) {
    setBusySlug(slug);
    try {
      const r = await api.post<InstalledService>("/api/v1/catalog-services", { slug });
      if (r.ok) {
        toast.success(`Installing ${slug}…`);
        await loadInstalled();
      } else {
        toast.error(
          r.status === 400
            ? `${slug} needs domain wiring (FQDN tokens) — not installable yet`
            : `Install failed (${r.status})`,
        );
      }
    } finally {
      setBusySlug(null);
    }
  }

  async function uninstall(svc: InstalledService) {
    const ok = await confirm({
      title: `Uninstall ${svc.name}?`,
      message: "Containers and volumes of this service will be removed.",
      danger: true,
    });
    if (!ok) return;
    const r = await api.del(`/api/v1/catalog-services/${svc.id}`);
    if (r.ok) {
      toast.success(`Uninstalled ${svc.name}`);
      await loadInstalled();
    } else toast.error(`Uninstall failed (${r.status})`);
  }

  const q = query.trim().toLowerCase();
  const filtered = (items ?? []).filter(
    (i) =>
      !q ||
      i.slug.includes(q) ||
      (i.category ?? "").toLowerCase().includes(q) ||
      i.tags.some((t) => t.toLowerCase().includes(q)),
  );

  return (
    <Page
      title="Catalog"
      subtitle="One-click services — browse templates and install onto your servers."
      actions={
        <input
          className="logview-search"
          aria-label="Search templates"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={items ? `Search ${items.length} templates…` : "Search templates…"}
        />
      }
    >
      {installed.length > 0 ? (
        <section className="card">
          <div className="card-head">
            <h2>Installed services</h2>
          </div>
          <ul className="app-list">
            {installed.map((s) => (
              <li key={s.id} className="app-row">
                <span className="app-name">{s.name}</span>
                <span className="muted mono">{s.slug}</span>
                <StatusPill status={s.status} />
                {s.error ? (
                  <span className="field-error mono" title={s.error}>
                    {s.error.slice(0, 80)}
                  </span>
                ) : null}
                <button
                  className="btn btn-ghost btn-sm"
                  aria-label={`Uninstall ${s.name}`}
                  onClick={() => void uninstall(s)}
                >
                  Uninstall
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card">
        <div className="card-head">
          <h2>Templates</h2>
          {items ? (
            <span className="muted">
              {filtered.length === items.length
                ? `${items.length} templates`
                : `${filtered.length} matches`}
            </span>
          ) : null}
        </div>
        {loading && !items ? (
          <SkeletonRows count={6} />
        ) : error ? (
          <ErrorState title="Couldn't load the catalog" message={error} onRetry={reload} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No matches" description="Try a different search term." />
        ) : (
          <>
            <ul className="app-list">
              {filtered.slice(0, SHOWN_CAP).map((i) => (
                <li key={i.slug} className="app-row">
                  <span className="app-name mono">{i.slug}</span>
                  <span className="muted">{i.slogan.slice(0, 90)}</span>
                  {i.category ? <span className="pill pill-neutral">{i.category}</span> : null}
                  <button
                    className="btn btn-primary btn-sm"
                    aria-label={`Install ${i.slug}`}
                    disabled={busySlug !== null}
                    onClick={() => void install(i.slug)}
                  >
                    {busySlug === i.slug ? "Installing…" : "Install"}
                  </button>
                </li>
              ))}
            </ul>
            {filtered.length > SHOWN_CAP ? (
              <p className="muted">
                Showing {SHOWN_CAP} of {filtered.length} — refine the search to see the rest.
              </p>
            ) : null}
          </>
        )}
      </section>
    </Page>
  );
}
