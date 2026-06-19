import { useEffect, useState } from "react";

// Minimal dependency-free hash router (the full app uses TanStack Router later,
// per 14-web-ui.md; this walking skeleton just needs dashboard <-> app detail).
export type Route =
  | { name: "dashboard" }
  | { name: "app"; appId: string }
  | { name: "settings" }
  | { name: "catalog" }
  | { name: "studio" }
  | { name: "backups" }
  | { name: "mail" }
  | { name: "invite"; token: string }
  | { name: "login-flow"; redirect: string };

function parse(): Route {
  const hash = window.location.hash.replace(/^#/, "");
  const m = /^\/apps\/([^/]+)/.exec(hash);
  if (m) return { name: "app", appId: m[1]! };
  if (hash === "/settings" || hash.startsWith("/settings/")) return { name: "settings" };
  if (hash === "/catalog" || hash.startsWith("/catalog/")) return { name: "catalog" };
  if (hash === "/studio" || hash.startsWith("/studio/")) return { name: "studio" };
  if (hash === "/backups" || hash.startsWith("/backups/")) return { name: "backups" };
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
