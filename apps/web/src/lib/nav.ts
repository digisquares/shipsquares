import type { Route } from "./router";

// Single source of truth for primary navigation (docs/web-ui/01, §3 + §10.1):
// the sidebar, the future mobile drawer, and ⌘K all read this one model. Groups
// map to mental models — Workspace (the org's apps), Platform (the machines),
// Admin (governance, role-gated). Only live routes are listed; Servers/Activity
// (P6) and the Admin group (P5) join as those pages land.
export type IconName =
  | "overview"
  | "database"
  | "backups"
  | "email"
  | "catalog"
  | "servers"
  | "gauge"
  | "activity"
  | "admin";

export interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  /** Route names that light this item as the active destination. */
  match: Route["name"][];
}

export interface NavGroup {
  group: string;
  /** When set, only these org roles see the group (P5). */
  roles?: string[];
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    group: "Workspace",
    items: [
      // App detail (route "app") lives under Overview until an Apps list exists.
      { label: "Overview", href: "#/", icon: "overview", match: ["dashboard", "app"] },
      { label: "Database", href: "#/studio", icon: "database", match: ["studio"] },
      { label: "Backups", href: "#/backups", icon: "backups", match: ["backups"] },
      { label: "Email", href: "#/mail", icon: "email", match: ["mail"] },
      { label: "Catalog", href: "#/catalog", icon: "catalog", match: ["catalog"] },
    ],
  },
  {
    group: "Platform",
    items: [
      { label: "Servers", href: "#/servers", icon: "servers", match: ["servers"] },
      {
        label: "DB Performance",
        href: "#/db-performance",
        icon: "gauge",
        match: ["db-performance"],
      },
      { label: "Activity", href: "#/activity", icon: "activity", match: ["activity"] },
    ],
  },
  {
    group: "Admin",
    roles: ["owner", "admin"],
    items: [{ label: "Admin", href: "#/admin/members", icon: "admin", match: ["admin"] }],
  },
];

/** Whether a nav item is the active destination for the current route. */
export function isNavItemActive(item: NavItem, routeName: Route["name"]): boolean {
  return item.match.includes(routeName);
}
