import { useCallback, useEffect, useState } from "react";

import { CopyButton } from "../components/copy-button";
import { EmptyState } from "../components/empty-state";
import { SkeletonRows } from "../components/skeleton";
import { UpdatesCard } from "../components/updates";
import { UserMenu } from "../components/user-menu";
import { api } from "../lib/api";
import { twoFactor, useSession } from "../lib/auth";
import { confirm } from "../lib/confirm";
import { type VcsConnection, connectionLabel } from "../lib/connections";
import { ORG_ROLES, memberLabel, scopesLabel } from "../lib/org";
import { pageTitle } from "../lib/page-title";
import { relativeTime } from "../lib/time";
import { toast } from "../lib/toast";

// The GitHub App install is a server route that 302s to GitHub (full navigation,
// not hash routing). Auth rides the session cookie.
const INSTALL_HREF = "/api/v1/vcs/github/app/install";

export function Settings() {
  useEffect(() => {
    document.title = pageTitle("Settings");
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <a href="#/" className="back-link">
            ←
          </a>
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">Settings</span>
        </div>
        <div className="topbar-right">
          <UserMenu />
        </div>
      </header>

      <main className="page">
        <div className="page-head">
          <nav className="crumbs" aria-label="Breadcrumb">
            <a href="#/">Dashboard</a>
            <span className="crumbs-sep" aria-hidden>
              /
            </span>
            <span aria-current="page">Settings</span>
          </nav>
          <h1>Settings</h1>
          <p className="muted">Git connections, members, API keys, and the AI assistant.</p>
        </div>

        <VcsConnectionsCard />
        <MembersCard />
        <ApiKeysCard />
        <TwoFactorCard />
        <AiSettingsCard />
        <UpdatesCard />
      </main>
    </div>
  );
}

interface Member {
  id: string;
  userId: string;
  email: string | null;
  name: string | null;
  role: string;
  createdAt: string;
}

function MembersCard() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<Member[]>("/api/v1/members");
    setMembers(r.ok ? r.data : []);
    setLoadFailed(!r.ok);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function changeRole(m: Member, role: string) {
    const r = await api.patch<Member>(`/api/v1/members/${m.id}`, { role });
    if (r.ok) {
      toast.success(`${memberLabel(m)} is now ${role}`);
    } else {
      // Owner invariants (last owner, self-demotion rules) come back as 4xx.
      toast.error(
        r.status === 409 || r.status === 400
          ? "That change would break the org's owner invariants"
          : `Role change failed (${r.status})`,
      );
    }
    await load(); // re-sync the select either way
  }

  async function remove(m: Member) {
    const ok = await confirm({
      title: "Remove member?",
      message: `${memberLabel(m)} loses all access to this org.`,
      danger: true,
    });
    if (!ok) return;
    const r = await api.del(`/api/v1/members/${m.id}`);
    if (r.ok) {
      toast.success("Member removed");
      await load();
    } else {
      toast.error(
        r.status === 409 || r.status === 400
          ? "The last owner can't be removed"
          : `Remove failed (${r.status})`,
      );
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Members</h2>
      </div>
      <p className="muted">
        Who can access this org and as what role. Invites by email arrive with outbound mail; for
        now, members join by signing up and being added by an admin.
      </p>

      {members === null ? (
        <SkeletonRows count={2} />
      ) : members.length > 0 ? (
        <ul className="app-list">
          {members.map((m) => (
            <li key={m.id} className="app-row">
              <span className="app-name">{memberLabel(m)}</span>
              <span className="app-id muted mono">{m.email ?? m.userId}</span>
              <select
                className="role-select"
                aria-label={`Role for ${memberLabel(m)}`}
                value={m.role}
                onChange={(e) => void changeRole(m, e.target.value)}
              >
                {ORG_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-ghost btn-sm"
                aria-label={`Remove ${memberLabel(m)}`}
                onClick={() => void remove(m)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : loadFailed ? (
        <p className="field-error">Couldn&apos;t load members — check the server and retry.</p>
      ) : (
        <EmptyState title="No members" description="You're the only one here so far." />
      )}

      <InvitesPanel />
    </section>
  );
}

interface Invite {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

function InvitesPanel() {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("deployer");
  const [sending, setSending] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.get<Invite[]>("/api/v1/members/invites");
    setInvites(r.ok ? r.data : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function invite() {
    setSending(true);
    const r = await api.post<Invite & { acceptUrl: string; emailed: boolean }>(
      "/api/v1/members/invites",
      { email: email.trim(), role },
    );
    setSending(false);
    if (r.ok) {
      setLastUrl(r.data.acceptUrl);
      setEmail("");
      toast.success(r.data.emailed ? `Invite emailed to ${r.data.email}` : "Invite created");
      await load();
    } else {
      toast.error(
        r.status === 403 ? "Your role can't invite at that level" : `Invite failed (${r.status})`,
      );
    }
  }

  async function revoke(inv: Invite) {
    const r = await api.del(`/api/v1/members/invites/${inv.id}`);
    if (r.ok) {
      toast.success("Invite revoked");
      await load();
    } else {
      toast.error(`Revoke failed (${r.status})`);
    }
  }

  return (
    <div className="invites">
      <h3 className="invites-title">Invites</h3>
      <p className="muted">
        Invite by email at a role; the invitee accepts a single-use link (delivered by email when
        SMTP is configured, or copy it below).
      </p>
      <div className="form-row">
        <label className="field">
          <span className="field-label">Email</span>
          <input
            className="chat-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
          />
        </label>
        <label className="field">
          <span className="field-label">Role</span>
          <select
            className="role-select"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label="Invite role"
          >
            {["admin", "deployer", "viewer"].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <div className="card-actions key-create-action">
          <button
            className="btn btn-primary btn-sm"
            disabled={sending || !email.trim()}
            onClick={() => void invite()}
          >
            {sending ? "Sending…" : "Send invite"}
          </button>
        </div>
      </div>

      {lastUrl && (
        <div className="key-minted" role="status">
          <span className="mono key-token">{lastUrl}</span>
          <CopyButton text={lastUrl} what="the invite link" />
          <span className="muted">Share this link — it expires in 7 days.</span>
        </div>
      )}

      {invites && invites.length > 0 && (
        <ul className="app-list">
          {invites.map((inv) => (
            <li key={inv.id} className="app-row">
              <span className="app-name">{inv.email}</span>
              <span className="app-id muted mono">{inv.role}</span>
              <span className="app-id muted">expires {relativeTime(inv.expiresAt)}</span>
              <button
                className="btn btn-ghost btn-sm"
                aria-label={`Revoke invite for ${inv.email}`}
                onClick={() => void revoke(inv)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ApiKey {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

function ApiKeysCard() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [minted, setMinted] = useState<{ name: string; token: string } | null>(null);

  const load = useCallback(async () => {
    const r = await api.get<ApiKey[]>("/api/v1/api-keys");
    setKeys(r.ok ? r.data : []);
    setLoadFailed(!r.ok);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    const r = await api.post<{ key: ApiKey; token: string }>("/api/v1/api-keys", {
      name: name.trim(),
    });
    setCreating(false);
    if (r.ok) {
      setMinted({ name: r.data.key.name, token: r.data.token });
      setName("");
      await load();
    } else {
      toast.error(
        r.status === 403 ? "Creating keys needs an org admin" : `Create failed (${r.status})`,
      );
    }
  }

  async function remove(k: ApiKey) {
    const ok = await confirm({
      title: "Delete API key?",
      message: `"${k.name}" stops working immediately — CLI/MCP/CI using it will 401.`,
      danger: true,
    });
    if (!ok) return;
    const r = await api.del(`/api/v1/api-keys/${k.id}`);
    if (r.ok) {
      toast.success("API key deleted");
      if (minted?.name === k.name) setMinted(null);
      await load();
    } else {
      toast.error(`Delete failed (${r.status})`);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>API keys</h2>
      </div>
      <p className="muted">
        Bearer tokens for the CLI, MCP clients, and CI (<code className="mono">ss_live_…</code>). A
        key acts with your role; it&apos;s shown once at creation.
      </p>

      <div className="form-row">
        <label className="field">
          <span className="field-label">Key name</span>
          <input
            className="chat-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ci-deploys"
            maxLength={120}
          />
        </label>
        <div className="card-actions key-create-action">
          <button
            className="btn btn-primary btn-sm"
            disabled={creating || !name.trim()}
            onClick={() => void create()}
          >
            {creating ? "Creating…" : "Create key"}
          </button>
        </div>
      </div>

      {minted && (
        <div className="key-minted" role="status">
          <span className="mono key-token">{minted.token}</span>
          <CopyButton text={minted.token} what={`the ${minted.name} token`} />
          <span className="muted">Copy it now — it won&apos;t be shown again.</span>
        </div>
      )}

      {keys === null ? (
        <SkeletonRows count={2} />
      ) : keys.length > 0 ? (
        <ul className="app-list">
          {keys.map((k) => (
            <li key={k.id} className="app-row">
              <span className="app-name">{k.name}</span>
              <span className="app-id muted mono">{scopesLabel(k.scopes)}</span>
              <span className="app-id muted">
                {k.lastUsedAt ? `used ${relativeTime(k.lastUsedAt)}` : "never used"}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                aria-label={`Delete the ${k.name} key`}
                onClick={() => void remove(k)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : loadFailed ? (
        <p className="field-error">Couldn&apos;t load API keys — check the server and retry.</p>
      ) : (
        <EmptyState title="No API keys" description="Create one for the CLI or CI." />
      )}
    </section>
  );
}

interface AiSettingsView {
  enabled: boolean;
  configured: boolean;
  keySource: "org" | "platform" | "none";
  keyHint: string | null;
  model: string;
}

function AiSettingsCard() {
  const [view, setView] = useState<AiSettingsView | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<AiSettingsView>("/api/v1/ai-settings");
    if (r.ok) {
      setView(r.data);
      setModel(r.data.model);
    } else {
      setView(null);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    const r = await api.put<AiSettingsView>("/api/v1/ai-settings", {
      // The key is write-only: only send it when the admin typed a new one.
      ...(apiKey ? { apiKey, enabled: true } : {}),
      ...(model ? { model } : {}),
    });
    setSaving(false);
    if (r.ok) {
      setApiKey("");
      setView(r.data);
      toast.success("AI settings saved");
    } else {
      toast.error(r.status === 403 ? "Saving needs an org admin" : `Save failed (${r.status})`);
    }
  }

  async function test() {
    setTesting(true);
    const r = await api.post<{ ok: boolean; model?: string; error?: string }>(
      "/api/v1/ai-settings/test",
    );
    setTesting(false);
    if (r.ok && r.data.ok) toast.success(`Key works (${r.data.model})`);
    else toast.error(r.ok ? `Test failed: ${r.data.error}` : `Test failed (${r.status})`);
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>AI assistant</h2>
        {view && (
          <span className="muted">
            {view.configured
              ? `key: ${view.keyHint} (${view.keySource})`
              : "no key configured — chat is off"}
          </span>
        )}
      </div>
      <p className="muted">
        Bring your own Claude API key — the assistant answers questions and runs platform actions
        with your permissions. The key is sealed at rest and never shown again.
      </p>

      <div className="form-row">
        <label className="field">
          <span className="field-label">Claude API key</span>
          <input
            type="password"
            className="chat-input"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={view?.configured ? "(unchanged)" : "sk-ant-…"}
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span className="field-label">Model</span>
          <input
            className="chat-input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="claude-sonnet-4-6"
          />
        </label>
      </div>
      <div className="card-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={saving || (!apiKey && model === (view?.model ?? ""))}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={testing || !view?.configured}
          onClick={() => void test()}
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
      </div>
    </section>
  );
}

function TwoFactorCard() {
  const { data, isPending } = useSession();
  const enabled = Boolean(
    (data?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
  );
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [enrol, setEnrol] = useState<{ uri: string; secret: string; backupCodes: string[] } | null>(
    null,
  );
  const [code, setCode] = useState("");

  async function start() {
    setBusy(true);
    const { data: d, error } = await twoFactor.enable({ password });
    setBusy(false);
    setPassword("");
    if (error || !d) {
      toast.error(error?.message ?? "Couldn't start enrolment — check your password");
      return;
    }
    const uri = (d as { totpURI?: string }).totpURI ?? "";
    const secret = /secret=([^&]+)/.exec(uri)?.[1] ?? "";
    setEnrol({ uri, secret, backupCodes: (d as { backupCodes?: string[] }).backupCodes ?? [] });
  }

  async function confirm2fa() {
    setBusy(true);
    const { error } = await twoFactor.verifyTotp({ code: code.trim() });
    setBusy(false);
    if (error) {
      toast.error("That code didn't match — try the current one.");
      return;
    }
    toast.success("Two-factor authentication enabled");
    setEnrol(null);
    setCode("");
    location.reload();
  }

  async function disable() {
    const ok = await confirm({
      title: "Disable two-factor?",
      message: "Your account will sign in with just a password again.",
      danger: true,
    });
    if (!ok) return;
    const { error } = await twoFactor.disable({ password });
    setPassword("");
    if (error) {
      toast.error(error.message ?? "Couldn't disable — check your password");
      return;
    }
    toast.success("Two-factor disabled");
    location.reload();
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Two-factor authentication</h2>
        {!isPending && <span className="muted">{enabled ? "enabled" : "off"}</span>}
      </div>
      <p className="muted">
        A time-based one-time code (TOTP) from an authenticator app, required at sign-in.
      </p>

      {enabled ? (
        <div className="form-row">
          <label className="field">
            <span className="field-label">Confirm password to disable</span>
            <input
              type="password"
              className="chat-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <div className="card-actions key-create-action">
            <button
              className="btn btn-ghost btn-sm"
              disabled={!password}
              onClick={() => void disable()}
            >
              Disable 2FA
            </button>
          </div>
        </div>
      ) : enrol ? (
        <div className="twofa-enrol">
          <p className="muted">
            Add this secret to your authenticator (or open the URI), then enter a code to confirm.
          </p>
          <div className="key-minted">
            <span className="mono key-token">{enrol.secret}</span>
            <CopyButton text={enrol.secret} what="the 2FA secret" />
          </div>
          {enrol.backupCodes.length > 0 && (
            <>
              <p className="muted">Backup codes — store these somewhere safe:</p>
              <pre className="sched-tail mono">{enrol.backupCodes.join("\n")}</pre>
            </>
          )}
          <div className="form-row">
            <label className="field">
              <span className="field-label">Code from your app</span>
              <input
                className="mono"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
            </label>
            <div className="card-actions key-create-action">
              <button
                className="btn btn-primary btn-sm"
                disabled={busy || !code.trim()}
                onClick={() => void confirm2fa()}
              >
                {busy ? "Confirming…" : "Confirm & enable"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="form-row">
          <label className="field">
            <span className="field-label">Confirm password to enable</span>
            <input
              type="password"
              className="chat-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <div className="card-actions key-create-action">
            <button
              className="btn btn-primary btn-sm"
              disabled={busy || !password}
              onClick={() => void start()}
            >
              {busy ? "Starting…" : "Enable 2FA"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function VcsConnectionsCard() {
  const [conns, setConns] = useState<VcsConnection[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<VcsConnection[]>("/api/v1/vcs-connections");
    setConns(r.ok ? r.data : []);
    setLoadFailed(!r.ok); // an outage must not masquerade as "no connections"
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function remove(c: VcsConnection) {
    const ok = await confirm({
      title: "Remove connection?",
      message: `${connectionLabel(c)} — apps that clone through it will stop auto-deploying.`,
      danger: true,
    });
    if (!ok) return;
    const r = await api.del(`/api/v1/vcs-connections/${c.id}`);
    if (r.ok) {
      toast.success("Connection removed");
      await load();
    } else {
      toast.error(`Remove failed (${r.status})`);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Git connections</h2>
        <a className="btn btn-primary btn-sm" href={INSTALL_HREF}>
          Connect GitHub
        </a>
      </div>
      <p className="muted">Connect a provider so a push auto-deploys the matching app.</p>

      {conns === null ? (
        <SkeletonRows count={2} />
      ) : conns.length > 0 ? (
        <ul className="app-list">
          {conns.map((c) => (
            <li key={c.id} className="app-row">
              <span className="app-name">{connectionLabel(c)}</span>
              <span className="app-id muted mono" title={new Date(c.createdAt).toLocaleString()}>
                {relativeTime(c.createdAt)}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                aria-label={`Remove ${connectionLabel(c)}`}
                onClick={() => void remove(c)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : loadFailed ? (
        <p className="field-error">Couldn&apos;t load connections — check the server and retry.</p>
      ) : (
        <EmptyState
          title="No git connections"
          description="Connect GitHub to deploy on push."
          action={
            <a className="btn btn-primary btn-sm" href={INSTALL_HREF}>
              Connect GitHub
            </a>
          }
        />
      )}
    </section>
  );
}
