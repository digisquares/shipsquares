import { type FormEvent, useEffect, useState } from "react";

import { signIn, twoFactor } from "../lib/auth";

const PROVIDER_LABEL: Record<string, string> = { github: "GitHub", google: "Google" };

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  // When a 2FA-enrolled user signs in, better-auth asks for a TOTP code
  // instead of returning a session (R3.3).
  const [needsTotp, setNeedsTotp] = useState(false);
  const [code, setCode] = useState("");

  // Which SSO providers the server has configured (R3.2) — public endpoint.
  useEffect(() => {
    void fetch("/sso-providers")
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((d: { providers?: string[] }) => setProviders(d.providers ?? []))
      .catch(() => setProviders([]));
  }, []);

  function ssoSignIn(provider: string): void {
    // The token rides the hash for invite deep-links; come back to wherever
    // we started so an invite-accept resumes after social login.
    void signIn.social({ provider, callbackURL: window.location.href });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { data, error } = await signIn.email({ email, password });
    if (error) {
      setError(error.message ?? "Sign-in failed. Check your email and password.");
      setLoading(false);
      return;
    }
    // 2FA-enrolled: collect a TOTP code before the session is issued.
    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      setNeedsTotp(true);
      setLoading(false);
      return;
    }
    // Session cookie is set; reload so the gate renders the dashboard.
    window.location.reload();
  }

  async function onVerifyTotp(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await twoFactor.verifyTotp({ code: code.trim() });
    if (error) {
      setError(error.message ?? "That code didn't match. Try the current one.");
      setLoading(false);
      return;
    }
    window.location.reload();
  }

  if (needsTotp) {
    return (
      <div className="center-screen auth-bg">
        <form className="auth-card" onSubmit={onVerifyTotp}>
          <div className="brand">
            <span className="brand-mark" aria-hidden />
            <span className="brand-name">ShipSquares</span>
          </div>
          <h1 className="auth-title">Two-factor code</h1>
          <p className="auth-sub">Enter the 6-digit code from your authenticator app.</p>
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          <label className="field">
            <span className="field-label">Code</span>
            <input
              className="mono"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "Verifying…" : "Verify"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="center-screen auth-bg">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">ShipSquares</span>
        </div>
        <h1 className="auth-title">Sign in</h1>
        <p className="auth-sub">Welcome back. Ship something today.</p>

        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}

        <label className="field">
          <span className="field-label">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>

        <label className="field">
          <span className="field-label">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>

        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>

        {providers.length > 0 && (
          <>
            <div className="auth-divider" aria-hidden>
              <span>or</span>
            </div>
            <div className="auth-sso">
              {providers.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => ssoSignIn(p)}
                >
                  Continue with {PROVIDER_LABEL[p] ?? p}
                </button>
              ))}
            </div>
          </>
        )}

        <p className="auth-foot">
          Self-hosted on your own infrastructure. <span className="dot-ok" /> Secure by default.
        </p>
      </form>
    </div>
  );
}
