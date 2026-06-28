import { NAV, isNavItemActive } from "../lib/nav";
import type { Route } from "../lib/router";

import { Icon } from "./icon";

// Primary navigation rail (docs/web-ui/01, §4). Renders the grouped NAV model
// with an active-route highlight; when collapsed it shows an icon-only rail and
// the labels become hover tooltips (via title). One source of truth (NAV) drives
// this and, later, the mobile drawer + ⌘K.
export function Sidebar({ routeName, isAdmin }: { routeName: Route["name"]; isAdmin: boolean }) {
  // Role-gated groups (e.g. Admin) only render for owners/admins (P5).
  const groups = NAV.filter((g) => !g.roles || isAdmin);
  return (
    <nav className="sidebar-nav" aria-label="Primary">
      {groups.map((group) => (
        <div className="nav-group" key={group.group}>
          <span className="nav-group-label" aria-hidden>
            {group.group}
          </span>
          <ul className="nav-list">
            {group.items.map((item) => {
              const active = isNavItemActive(item, routeName);
              return (
                <li key={item.href}>
                  <a
                    className={`nav-item${active ? " active" : ""}`}
                    href={item.href}
                    title={item.label}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon name={item.icon} />
                    <span className="nav-item-label">{item.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
