import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useSession } from "../lib/auth";
import { go } from "../lib/router";

import { Login } from "./login";

// Invite-accept landing (R3.4): /#/invite?token=… . Requires a session — a
// logged-out visitor sees the login screen, then lands back here and accepts.
// On success the membership exists; reload re-scopes the app to the new org.
export function InviteAccept({ token }: { token: string }) {
  const { data, isPending } = useSession();
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState("Accepting your invite…");

  useEffect(() => {
    if (isPending || !data) return;
    let alive = true;
    void (async () => {
      const r = await api.post<{ organizationId: string; role: string }>(
        "/api/v1/members/invites/accept",
        { token },
      );
      if (!alive) return;
      if (r.ok) {
        setState("ok");
        setMessage(`You've joined as ${r.data.role}. Taking you in…`);
        setTimeout(() => {
          go("#/");
          location.reload();
        }, 1200);
      } else {
        setState("error");
        setMessage(
          r.status === 410
            ? "This invite has expired — ask for a new one."
            : r.status === 403
              ? "This invite was sent to a different email address."
              : r.status === 409
                ? "This invite is no longer valid."
                : `Couldn't accept the invite (HTTP ${r.status}).`,
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [data, isPending, token]);

  if (isPending) return null;
  if (!data) return <Login />;

  return (
    <div className="app-shell">
      <main className="page">
        <div className="card invite-accept">
          <h1>Organization invite</h1>
          <p className={state === "error" ? "field-error" : "muted"}>{message}</p>
          {state === "error" && (
            <a className="btn btn-ghost btn-sm" href="#/">
              Go to dashboard
            </a>
          )}
        </div>
      </main>
    </div>
  );
}
