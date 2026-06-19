import { useState } from "react";

import { api } from "../lib/api";
import { useSession } from "../lib/auth";
import { go } from "../lib/router";

// Device Login Flow consent (docs/mobile/01-architecture.md). A native app sent the
// browser to `${server}/login/flow?redirect=ss://login`, which bounced here once the
// user is signed in. "Authorize" mints a device-scoped token and hands it back over
// the deep link; the app never sees the user's credentials.

/** Only ever hand a token to the app's own custom scheme — never an http(s) origin. */
function isAllowedRedirect(redirect: string): boolean {
  try {
    const u = new URL(redirect);
    return u.protocol === "ss:" && u.hostname === "login";
  } catch {
    return false;
  }
}

export function LoginFlow({ redirect }: { redirect: string }) {
  const { data } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = isAllowedRedirect(redirect);
  const email = data?.user?.email ?? null;

  async function authorize() {
    setBusy(true);
    setError(null);
    const res = await api.post<{ token?: string; message?: string }>(
      "/api/v1/login/flow/authorize",
      { redirect },
    );
    if (!res.ok || !res.data?.token) {
      setError(res.data?.message ?? "Couldn't authorize this device. Try again.");
      setBusy(false);
      return;
    }
    // Hand the token back to the app over its deep link, with the server origin so
    // the app knows which Cloud it just connected to.
    const url = `${redirect}?token=${encodeURIComponent(res.data.token)}&server=${encodeURIComponent(
      window.location.origin,
    )}`;
    window.location.href = url;
  }

  return (
    <div className="center-screen auth-bg">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">ShipSquares</span>
        </div>
        <h1 className="auth-title">Authorize device</h1>
        <p className="auth-sub">
          A device wants to connect to this control plane{email ? ` as ${email}` : ""}. It will get
          its own revocable token — manage it later under Settings → API keys.
        </p>

        {!allowed ? (
          <div className="alert" role="alert">
            This login link is invalid or has an unexpected return target, so it won't be honored.
          </div>
        ) : (
          <>
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            <button className="btn btn-primary" type="button" disabled={busy} onClick={authorize}>
              {busy ? "Authorizing…" : "Authorize this device"}
            </button>
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => go("/")}>
              Cancel
            </button>
          </>
        )}

        <p className="auth-foot">
          Only authorize a device you started signing in from. <span className="dot-ok" /> The token
          never exceeds your own role.
        </p>
      </div>
    </div>
  );
}
