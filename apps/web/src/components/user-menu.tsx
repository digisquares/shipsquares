import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { signOut, useSession } from "../lib/auth";
import { go } from "../lib/router";
import { useTheme } from "../lib/theme";

interface MyOrg {
  id: string;
  name: string;
  role: string;
  active: boolean;
}

// Top-bar user menu (25-design-system.md, Shell). Self-contained: pulls the
// session itself, so both pages just render <UserMenu/>. Accessible menu —
// aria-haspopup/expanded, Esc + click-outside close; reduced-motion gated.
export function UserMenu() {
  const { data } = useSession();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<MyOrg[]>([]);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Load the user's orgs lazily when the menu opens (drives the switcher).
  const loadOrgs = useCallback(async () => {
    const r = await api.get<MyOrg[]>("/api/v1/me/organizations");
    if (r.ok) setOrgs(r.data);
  }, []);
  useEffect(() => {
    if (open) void loadOrgs();
  }, [open, loadOrgs]);

  async function activate(id: string) {
    setSwitching(true);
    const r = await api.post(`/api/v1/organizations/${id}/activate`);
    setSwitching(false);
    // The active org rides the session; reload so every view re-scopes.
    if (r.ok) location.reload();
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const email = data?.user?.email ?? "you";
  const initial = email.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="usermenu" ref={ref}>
      <button
        type="button"
        className="usermenu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="usermenu-avatar" aria-hidden>
          {initial}
        </span>
        <span className="usermenu-email">{email}</span>
      </button>
      {open ? (
        <div className="usermenu-pop" role="menu">
          <div className="usermenu-head">
            <span className="usermenu-avatar" aria-hidden>
              {initial}
            </span>
            <span className="muted mono">{email}</span>
          </div>
          {orgs.length > 1 && (
            <div className="usermenu-orgs" role="group" aria-label="Switch organization">
              <span className="usermenu-section">Organization</span>
              {orgs.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={o.active}
                  disabled={switching || o.active}
                  className={`usermenu-item usermenu-org${o.active ? " on" : ""}`}
                  onClick={() => void activate(o.id)}
                >
                  <span className="usermenu-org-check" aria-hidden>
                    {o.active ? "●" : "○"}
                  </span>
                  <span className="usermenu-org-name">{o.name}</span>
                  <span className="muted usermenu-org-role">{o.role}</span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            className="usermenu-item"
            onClick={() => {
              go("#/settings");
              setOpen(false);
            }}
          >
            Settings
          </button>
          <button
            type="button"
            role="menuitem"
            className="usermenu-item"
            onClick={() => {
              toggle();
              setOpen(false);
            }}
          >
            Switch to {theme === "dark" ? "light" : "dark"} theme
          </button>
          <button
            type="button"
            role="menuitem"
            className="usermenu-item"
            onClick={() => void signOut().then(() => location.reload())}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
