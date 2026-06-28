import { Fragment, type ReactNode } from "react";

// The one page scaffold (docs/web-ui/01-shell-navigation-and-layouts.md, §6).
// Every page renders its header the same way — optional breadcrumb, a title, an
// optional subtitle, and right-aligned actions — then its own content. The width
// variant picks the content measure per page type (#9): wide for data-dense
// pages, narrow for forms/settings, default otherwise.
export interface Crumb {
  label: string;
  href?: string;
}

export function Page({
  title,
  subtitle,
  crumbs,
  actions,
  width = "default",
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  width?: "default" | "wide" | "narrow";
  children: ReactNode;
}) {
  return (
    <main className={width === "default" ? "page" : `page page-${width}`}>
      <div className="page-head">
        {crumbs && crumbs.length > 0 && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <span className="crumbs-sep" aria-hidden>
                    /
                  </span>
                )}
                {c.href ? (
                  <a href={c.href}>{c.label}</a>
                ) : (
                  <span aria-current="page">{c.label}</span>
                )}
              </Fragment>
            ))}
          </nav>
        )}
        <div className="page-head-row">
          <div className="page-head-titles">
            <h1>{title}</h1>
            {subtitle != null && <p className="muted">{subtitle}</p>}
          </div>
          {actions != null && <div className="page-actions">{actions}</div>}
        </div>
      </div>
      {children}
    </main>
  );
}
