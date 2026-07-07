import { lazy, Suspense, useRef } from "react";

import { AppShell } from "./components/app-shell";
import { ChatPanel } from "./components/chat-panel";
import { CommandPalette } from "./components/command-palette";
import { ConfirmDialog } from "./components/confirm-dialog";
import { SkeletonRows } from "./components/skeleton";
import { Toaster } from "./components/toaster";
import { useSession } from "./lib/auth";
import { useRoute } from "./lib/router";
import { Activity } from "./pages/activity";
import { Admin } from "./pages/admin";
import { AppDetail } from "./pages/app-detail";
import { Backups } from "./pages/backups";
import { Catalog } from "./pages/catalog";
import { Dashboard } from "./pages/dashboard";
import { DbPerformance } from "./pages/db-performance";
import { InviteAccept } from "./pages/invite";
import { Login } from "./pages/login";
import { LoginFlow } from "./pages/login-flow";
import { Mail } from "./pages/mail";
import { Servers } from "./pages/servers";
import { Settings } from "./pages/settings";

// Code-split the Database Studio: its grid/editor deps (TanStack) stay out of the
// main bundle and load only when the route is opened (database-studio/05).
const Studio = lazy(() => import("./pages/studio").then((m) => ({ default: m.Studio })));

// Session gate + minimal hash routing. (TanStack Router + the full route map land
// with the rest of 14-web-ui.md.)
export function App() {
  const { data, isPending } = useSession();
  const route = useRoute();

  // Only block on the FIRST session resolution. better-auth refetches the
  // session on every window-focus/visibility/online event and, while logged
  // out (data === null), flips isPending back to true for each refetch. If we
  // re-showed the skeleton on those, <Login> would unmount mid-typing and the
  // entered email/password would be wiped. Once settled, render from `data`.
  const settledRef = useRef(false);
  if (!isPending) settledRef.current = true;

  if (isPending && !settledRef.current) {
    return (
      <div className="app-shell" aria-busy="true" aria-label="Loading">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden />
            <span className="brand-name">ShipSquares</span>
          </div>
        </header>
        <main className="page">
          <div className="card">
            <SkeletonRows count={3} />
          </div>
        </main>
      </div>
    );
  }
  // Invite accept self-gates (shows Login while logged out, preserving the
  // token in the hash), so it sits ahead of the session gate.
  if (route.name === "invite") return <InviteAccept token={route.token} />;
  if (!data) return <Login />;
  // Device Login Flow consent — only the signed-in user can authorize a device.
  if (route.name === "login-flow") return <LoginFlow redirect={route.redirect} />;
  // Every authenticated page renders inside the one shared <AppShell> (P1–P7),
  // including the full-bleed Database Studio (folded in at P7).
  const page =
    route.name === "app" ? (
      // key: a fresh instance per app — switching app→app (⌘K) must not keep
      // the previous app's selected deployment / logs WS / metrics.
      <AppDetail key={route.appId} appId={route.appId} tab={route.tab} />
    ) : route.name === "settings" ? (
      <Settings />
    ) : route.name === "admin" ? (
      <Admin section={route.section} />
    ) : route.name === "catalog" ? (
      <Catalog />
    ) : route.name === "backups" ? (
      <Backups />
    ) : route.name === "servers" ? (
      <Servers />
    ) : route.name === "db-performance" ? (
      <DbPerformance />
    ) : route.name === "activity" ? (
      <Activity />
    ) : route.name === "mail" ? (
      <Mail />
    ) : route.name === "studio" ? (
      <Suspense
        fallback={
          <div className="app-detail-loading" aria-busy="true" aria-label="Loading Database Studio">
            <SkeletonRows count={6} />
          </div>
        }
      >
        <Studio />
      </Suspense>
    ) : (
      <Dashboard />
    );

  return (
    <>
      <AppShell>{page}</AppShell>
      <CommandPalette />
      <ChatPanel />
      <Toaster />
      <ConfirmDialog />
    </>
  );
}
