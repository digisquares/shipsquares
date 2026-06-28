import { type ReactNode, useCallback, useEffect, useState } from "react";

import { api } from "../lib/api";
import { useRoute } from "../lib/router";

import { Icon } from "./icon";
import { Sidebar } from "./sidebar";
import { UpdateBadge } from "./updates";
import { UserMenu } from "./user-menu";

// The single application shell (docs/web-ui/01-shell-navigation-and-layouts.md,
// phases P1–P7). A CSS grid: a full-width topbar (brand + global actions) over a
// persistent left nav rail and the routed content. The rail collapses to an
// icon strip (persisted); below 768px it becomes an off-canvas drawer. Search
// and Assistant are absorbed from floating FABs into the topbar (P7).
const RAIL_KEY = "ss-rail";

const openPalette = () => window.dispatchEvent(new CustomEvent("ss:command-palette"));
const openAssistant = () => window.dispatchEvent(new CustomEvent("ss:assistant"));

export function AppShell({ children }: { children: ReactNode }) {
  const route = useRoute();
  const [collapsed, setCollapsed] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem(RAIL_KEY) === "collapsed",
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Role gate for the Admin nav group: derive admin/owner from the active org.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let alive = true;
    void api.get<{ role: string; active: boolean }[]>("/api/v1/me/organizations").then((r) => {
      if (!alive || !r.ok) return;
      const active = r.data.find((o) => o.active) ?? r.data[0];
      setIsAdmin(active?.role === "owner" || active?.role === "admin");
    });
    return () => {
      alive = false;
    };
  }, []);

  // Any route change closes the mobile drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [route]);

  const toggleRail = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(RAIL_KEY, next ? "collapsed" : "expanded");
      } catch {
        // private mode / storage disabled — collapse just won't persist
      }
      return next;
    });
  }, []);

  // Studio is its own full-bleed 2-pane app — keep the nav as an icon rail there.
  const railCollapsed = collapsed || route.name === "studio";

  return (
    <div
      className="app-shell"
      data-rail={railCollapsed ? "collapsed" : "expanded"}
      data-drawer={drawerOpen ? "open" : "closed"}
    >
      <header className="topbar">
        <div className="topbar-left">
          <button
            type="button"
            className="drawer-toggle"
            aria-label={drawerOpen ? "Close menu" : "Open menu"}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
          >
            <Icon name="menu" />
          </button>
          <a className="brand" href="#/" aria-label="ShipSquares — dashboard">
            <span className="brand-mark" aria-hidden />
            <span className="brand-name">ShipSquares</span>
          </a>
        </div>
        <div className="topbar-right">
          <button
            type="button"
            className="btn btn-ghost btn-sm topbar-search"
            aria-label="Open command palette"
            onClick={openPalette}
          >
            <Icon name="search" />
            <span className="topbar-search-label">Search</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Open the assistant"
            onClick={openAssistant}
          >
            Assistant
          </button>
          <UpdateBadge />
          <UserMenu />
        </div>
      </header>

      <aside className="sidebar">
        <Sidebar routeName={route.name} isAdmin={isAdmin} />
        <button
          type="button"
          className="rail-toggle"
          onClick={toggleRail}
          aria-pressed={collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <Icon name="chevron" />
          <span className="nav-item-label">Collapse</span>
        </button>
      </aside>

      {drawerOpen && (
        <button
          type="button"
          className="drawer-scrim"
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <div className="app-content">{children}</div>
    </div>
  );
}
