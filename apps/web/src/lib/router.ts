import { useEffect, useState } from "react";

// Minimal dependency-free hash router (the full app uses TanStack Router later,
// per 14-web-ui.md; this walking skeleton just needs dashboard <-> app detail).
export type Route =
  | { name: "dashboard" }
  | { name: "app"; appId: string; tab?: string }
  | { name: "settings" }
  | { name: "admin"; section: string }
  | { name: "catalog" }
  | { name: "studio" }
  | { name: "backups" }
  | { name: "servers" }
  | { name: "db-performance" }
  | { name: "activity" }
  | { name: "mail" }
  | { name: "invite"; token: string }
  | { name: "login-flow"; redirect: string };

function parse(): Route {
  const hash = window.location.hash.replace(/^#/, "");
  // appId stops at "/" or "?"; the optional ?tab= picks the detail tab (P4).
  const m = /^\/apps\/([^/?]+)/.exec(hash);
  if (m) {
    const tab = new URLSearchParams(hash.split("?")[1] ?? "").get("tab");
    return { name: "app", appId: m[1]!, ...(tab ? { tab } : {}) };
  }
  if (hash === "/settings" || hash.startsWith("/settings/")) return { name: "settings" };
  // Org admin (P5): #/admin/<section>, default section "members".
  if (hash === "/admin" || hash.startsWith("/admin/")) {
    const section = hash.replace(/^\/admin\/?/, "").split(/[/?]/)[0] || "members";
    return { name: "admin", section };
  }
  if (hash === "/catalog" || hash.startsWith("/catalog/")) return { name: "catalog" };
  if (hash === "/studio" || hash.startsWith("/studio/")) return { name: "studio" };
  if (hash === "/backups" || hash.startsWith("/backups/")) return { name: "backups" };
  if (hash === "/servers" || hash.startsWith("/servers/")) return { name: "servers" };
  if (hash === "/db-performance" || hash.startsWith("/db-performance/"))
    return { name: "db-performance" };
  if (hash === "/activity" || hash.startsWith("/activity/")) return { name: "activity" };
  if (hash === "/mail" || hash.startsWith("/mail/")) return { name: "mail" };
  const inv = /^\/invite\?token=([^&]+)/.exec(hash);
  if (inv) return { name: "invite", token: decodeURIComponent(inv[1]!) };
  // Device Login Flow consent (docs/mobile/01): /login/flow bounces here.
  const lf = /^\/login-flow\?redirect=([^&]+)/.exec(hash);
  if (lf) return { name: "login-flow", redirect: decodeURIComponent(lf[1]!) };
  return { name: "dashboard" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse());
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function go(hash: string): void {
  window.location.hash = hash;
}
