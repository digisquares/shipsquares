import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { EmptyState } from "../components/empty-state";
import { Page } from "../components/page";
import { SkeletonRows } from "../components/skeleton";
import { StatusPill } from "../components/status-pill";
import { api } from "../lib/api";
import { confirm } from "../lib/confirm";
import { pageTitle } from "../lib/page-title";
import { toast } from "../lib/toast";

// Managed-email workspace (R9 · mail/07-ui-ux-review.md). The single pane of
// glass over Stalwart: connect a server, add a domain, watch DNS verify live,
// and manage mailboxes + aliases — the user never touches Stalwart's admin.

interface MailInstance {
  id: string;
  hostname: string;
  status: string;
  port25Egress: string;
  ptrOk: boolean | null;
}
interface MailDomain {
  id: string;
  fqdn: string;
  dkimSelector: string;
  dnsMode: string;
  verificationStatus: string;
  inboxSubdomain: string;
}
interface DnsRecord {
  id: string;
  kind: string;
  name: string;
  type: string;
  value: string;
  priority: number | null;
  status: string;
  detail: string | null;
}
interface Mailbox {
  id: string;
  localPart: string;
  displayName: string | null;
  status: string;
}
interface Alias {
  id: string;
  alias: string;
  destinations: string[];
}
interface CatalogServiceLite {
  id: string;
  slug: string;
  name: string;
  status: string;
}
interface ServerLite {
  id: string;
  name: string;
  host: string;
}

// ── pure helpers (unit-tested) ──────────────────────────────────────────────

/** Human label for a DNS record's mail purpose. */
export function dnsKindLabel(kind: string): string {
  const map: Record<string, string> = {
    mx: "MX",
    spf: "SPF",
    dkim: "DKIM",
    dmarc: "DMARC",
    tlsa: "TLSA",
    mta_sts: "MTA-STS",
    tls_rpt: "TLS-RPT",
    caa: "CAA",
    autoconfig: "Autoconfig",
    autodiscover: "Autodiscover",
    srv: "SRV",
  };
  return map[kind] ?? kind.toUpperCase();
}

export function isValidFqdn(s: string): boolean {
  const v = s.trim().toLowerCase();
  return v.length <= 253 && /^(?=.{1,253}$)([a-z0-9](-*[a-z0-9])*\.)+[a-z]{2,}$/.test(v);
}

export function isValidLocalPart(s: string): boolean {
  return /^[a-z0-9._+-]+$/i.test(s.trim());
}

function copy(text: string): void {
  void navigator.clipboard?.writeText?.(text);
  toast.success("Copied to clipboard");
}

// ── reusable accessible modal (reuses the confirm visual language) ──────────

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="cmdk-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="confirm"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <h2 className="confirm-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function PasswordDialog({
  address,
  password,
  onClose,
}: {
  address: string;
  password: string;
  onClose: () => void;
}) {
  return (
    <Modal title="Mailbox created" onClose={onClose}>
      <p className="confirm-msg muted">
        Save this one-time password for <span className="mono">{address}</span> — it won&apos;t be
        shown again.
      </p>
      <code className="mail-secret" aria-label="mailbox password">
        {password}
      </code>
      <div className="confirm-actions">
        <button type="button" className="btn btn-ghost" onClick={() => copy(password)}>
          Copy
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function ConnectInstanceModal({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: () => void;
}) {
  const [svcs, setSvcs] = useState<CatalogServiceLite[] | null>(null);
  const [servers, setServers] = useState<ServerLite[]>([]);
  const [catalogServiceId, setCatalogServiceId] = useState("");
  const [serverId, setServerId] = useState("");
  const [hostname, setHostname] = useState("");
  const [adminSecret, setAdminSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    void api.get<CatalogServiceLite[]>("/api/v1/catalog-services").then((r) => {
      const list = r.ok && Array.isArray(r.data) ? r.data.filter((s) => s.slug === "stalwart") : [];
      setSvcs(list);
      if (list[0]) setCatalogServiceId(list[0].id);
    });
    void api.get<{ data: ServerLite[] }>("/api/v1/servers").then((r) => {
      const list = r.ok && r.data?.data ? r.data.data : [];
      setServers(list);
      if (list[0]) setServerId(list[0].id);
    });
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!catalogServiceId || !serverId || !hostname.trim() || !adminSecret) {
      setErr("All fields are required.");
      return;
    }
    setBusy(true);
    setErr("");
    const r = await api.post("/api/v1/mail/instances", {
      catalogServiceId,
      serverId,
      hostname: hostname.trim(),
      adminSecret,
    });
    setBusy(false);
    if (r.ok) {
      toast.success("Mail server connected");
      onConnected();
    } else {
      setErr(`Could not connect (${r.status}).`);
    }
  }

  return (
    <Modal title="Connect a mail server" onClose={onClose}>
      {svcs === null ? (
        <p className="confirm-msg muted">Loading…</p>
      ) : svcs.length === 0 ? (
        <>
          <p className="confirm-msg muted">
            No Stalwart install found. Deploy Stalwart from the catalog first, then connect it here.
          </p>
          <div className="confirm-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
            <a className="btn btn-primary" href="#/catalog" onClick={onClose}>
              Browse catalog
            </a>
          </div>
        </>
      ) : (
        <form className="confirm-form" onSubmit={(e) => void submit(e)}>
          <label>
            Stalwart install
            <select
              aria-label="Stalwart install"
              value={catalogServiceId}
              onChange={(e) => setCatalogServiceId(e.target.value)}
            >
              {svcs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.status})
                </option>
              ))}
            </select>
          </label>
          <label>
            Server
            <select
              aria-label="Server"
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.host}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mail hostname (MX FQDN)
            <input
              aria-label="Mail hostname"
              placeholder="mail.example.com"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
            />
          </label>
          <label>
            Admin secret
            <input
              aria-label="Admin secret"
              type="password"
              placeholder="Stalwart admin token"
              value={adminSecret}
              onChange={(e) => setAdminSecret(e.target.value)}
            />
          </label>
          {err && <p className="field-error">{err}</p>}
          <div className="confirm-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ── domain row ──────────────────────────────────────────────────────────────

function DomainRow({ domain }: { domain: MailDomain }) {
  const [status, setStatus] = useState(domain.verificationStatus);
  const [dns, setDns] = useState<DnsRecord[] | "loading" | null>(null);
  const [boxes, setBoxes] = useState<Mailbox[] | "loading" | null>(null);
  const [aliases, setAliases] = useState<Alias[] | "loading" | null>(null);
  const [local, setLocal] = useState("");
  const [localErr, setLocalErr] = useState("");
  const [aliasName, setAliasName] = useState("");
  const [aliasDest, setAliasDest] = useState("");
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState<{ address: string; password: string } | null>(null);

  const loadDns = useCallback(async () => {
    const r = await api.get<DnsRecord[]>(`/api/v1/mail/domains/${domain.id}/dns`);
    setDns(r.ok && Array.isArray(r.data) ? r.data : []);
  }, [domain.id]);
  const loadBoxes = useCallback(async () => {
    const r = await api.get<Mailbox[]>(`/api/v1/mail/domains/${domain.id}/mailboxes`);
    setBoxes(r.ok && Array.isArray(r.data) ? r.data : []);
  }, [domain.id]);
  const loadAliases = useCallback(async () => {
    const r = await api.get<Alias[]>(`/api/v1/mail/domains/${domain.id}/aliases`);
    setAliases(r.ok && Array.isArray(r.data) ? r.data : []);
  }, [domain.id]);

  function toggleDns() {
    if (dns) {
      setDns(null);
      return;
    }
    setDns("loading");
    void loadDns();
  }
  function toggleBoxes() {
    if (boxes) {
      setBoxes(null);
      return;
    }
    setBoxes("loading");
    void loadBoxes();
  }
  function toggleAliases() {
    if (aliases) {
      setAliases(null);
      return;
    }
    setAliases("loading");
    void loadAliases();
  }

  // Live auto-refresh while the DNS panel is open and the domain isn't settled.
  useEffect(() => {
    if (!dns || dns === "loading") return;
    if (status !== "pending" && status !== "verifying") return;
    const t = window.setInterval(() => {
      void api.get<MailDomain>(`/api/v1/mail/domains/${domain.id}`).then((r) => {
        if (r.ok && r.data) setStatus(r.data.verificationStatus);
      });
      void loadDns();
    }, 6000);
    return () => window.clearInterval(t);
  }, [dns, status, domain.id, loadDns]);

  async function verify() {
    setBusy(true);
    const r = await api.post<MailDomain>(`/api/v1/mail/domains/${domain.id}/verify`);
    setBusy(false);
    if (r.ok && r.data) {
      setStatus(r.data.verificationStatus);
      toast.success("Re-checking DNS…");
      if (dns && dns !== "loading") void loadDns();
    } else {
      toast.error(`Could not start verification (${r.status}).`);
    }
  }

  async function addMailbox(e: FormEvent) {
    e.preventDefault();
    const lp = local.trim().toLowerCase();
    if (!isValidLocalPart(lp)) {
      setLocalErr("Use letters, digits, and . _ + - only.");
      return;
    }
    setLocalErr("");
    setBusy(true);
    const r = await api.post<{ password: string }>(`/api/v1/mail/domains/${domain.id}/mailboxes`, {
      localPart: lp,
    });
    setBusy(false);
    if (r.ok && r.data) {
      setLocal("");
      setPw({ address: `${lp}@${domain.fqdn}`, password: r.data.password });
      await loadBoxes();
    } else {
      toast.error(`Could not create mailbox (${r.status}).`);
    }
  }

  async function delMailbox(b: Mailbox) {
    const ok = await confirm({
      title: `Delete ${b.localPart}@${domain.fqdn}?`,
      message: "The mailbox and its stored messages are removed. This cannot be undone.",
      danger: true,
    });
    if (!ok) return;
    const r = await api.del(`/api/v1/mail/mailboxes/${b.id}`);
    if (r.ok) {
      toast.success("Mailbox deleted");
      await loadBoxes();
    } else {
      toast.error(`Delete failed (${r.status}).`);
    }
  }

  async function addAlias(e: FormEvent) {
    e.preventDefault();
    const a = aliasName.trim().toLowerCase();
    const dests = aliasDest
      .split(/[,\s]+/)
      .map((d) => d.trim())
      .filter(Boolean);
    if (!isValidLocalPart(a) || dests.length === 0) return;
    setBusy(true);
    const r = await api.post(`/api/v1/mail/domains/${domain.id}/aliases`, {
      alias: a,
      destinations: dests,
    });
    setBusy(false);
    if (r.ok) {
      setAliasName("");
      setAliasDest("");
      await loadAliases();
    } else {
      toast.error(`Could not create alias (${r.status}).`);
    }
  }

  async function delAlias(al: Alias) {
    const ok = await confirm({ title: `Delete alias ${al.alias}@${domain.fqdn}?`, danger: true });
    if (!ok) return;
    const r = await api.del(`/api/v1/mail/aliases/${al.id}`);
    if (r.ok) {
      toast.success("Alias deleted");
      await loadAliases();
    } else {
      toast.error(`Delete failed (${r.status}).`);
    }
  }

  return (
    <li className="mail-domain">
      <div className="mail-domain-top">
        <span className="app-name mono">{domain.fqdn}</span>
        <StatusPill status={status} />
        <span className="muted" title="DNS publishing mode">
          {domain.dnsMode === "auto" ? "auto-DNS" : "manual DNS"}
        </span>
        <a className="muted mono" href={`https://${domain.inboxSubdomain}`} title="Open the inbox">
          {domain.inboxSubdomain}
        </a>
        <span className="mail-spacer" />
        <button className="btn btn-ghost btn-sm" onClick={toggleDns}>
          {dns ? "Hide DNS" : "DNS"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={toggleBoxes}>
          {boxes ? "Hide mailboxes" : "Mailboxes"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={toggleAliases}>
          {aliases ? "Hide aliases" : "Aliases"}
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => void verify()} disabled={busy}>
          {busy ? "…" : "Verify"}
        </button>
      </div>

      {dns && (
        <div className="mail-section">
          <p className="mail-section-title">Required DNS records</p>
          <ul className="mail-dns">
            {dns === "loading" ? (
              <li className="muted">Loading…</li>
            ) : dns.length === 0 ? (
              <li className="muted">No records.</li>
            ) : (
              dns.map((r) => (
                <li key={r.id} className="mail-dns-row">
                  <span className="pill pill-neutral">{dnsKindLabel(r.kind)}</span>
                  <span className="muted mono">{r.type}</span>
                  <span className="mono mail-dns-name">{r.name}</span>
                  <span className="mono mail-dns-value" title={r.value}>
                    {r.value}
                  </span>
                  <StatusPill status={r.status} />
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => copy(r.value)}
                    aria-label={`Copy ${dnsKindLabel(r.kind)} value`}
                  >
                    Copy
                  </button>
                  {r.detail && (
                    <span className="field-error" title={r.detail}>
                      {r.detail.slice(0, 80)}
                    </span>
                  )}
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {boxes && (
        <div className="mail-section">
          <p className="mail-section-title">Mailboxes</p>
          <form className="mail-add" onSubmit={(e) => void addMailbox(e)}>
            <div className="mail-add-field">
              <input
                aria-label={`New mailbox local part for ${domain.fqdn}`}
                aria-invalid={localErr ? true : undefined}
                placeholder="alice"
                value={local}
                onChange={(e) => setLocal(e.target.value)}
              />
              {localErr && <span className="field-error">{localErr}</span>}
            </div>
            <span className="muted mono">@{domain.fqdn}</span>
            <button className="btn btn-primary btn-sm" disabled={busy}>
              Add mailbox
            </button>
          </form>
          <ul className="mail-list">
            {boxes === "loading" ? (
              <li className="muted">Loading…</li>
            ) : boxes.length === 0 ? (
              <li className="muted">No mailboxes yet.</li>
            ) : (
              boxes.map((b) => (
                <li key={b.id} className="mail-list-row">
                  <span className="mono">
                    {b.localPart}@{domain.fqdn}
                  </span>
                  {b.displayName && <span className="muted">{b.displayName}</span>}
                  <StatusPill status={b.status} />
                  <span className="mail-spacer" />
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void delMailbox(b)}
                    aria-label={`Delete mailbox ${b.localPart}@${domain.fqdn}`}
                  >
                    Delete
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {aliases && (
        <div className="mail-section">
          <p className="mail-section-title">Aliases</p>
          <form className="mail-add" onSubmit={(e) => void addAlias(e)}>
            <div className="mail-add-field">
              <input
                aria-label={`New alias for ${domain.fqdn}`}
                placeholder="team"
                value={aliasName}
                onChange={(e) => setAliasName(e.target.value)}
              />
            </div>
            <div className="mail-add-field">
              <input
                aria-label="Alias destinations (comma-separated)"
                placeholder="alice@acme.com, bob@acme.com"
                value={aliasDest}
                onChange={(e) => setAliasDest(e.target.value)}
              />
            </div>
            <button className="btn btn-primary btn-sm" disabled={busy}>
              Add alias
            </button>
          </form>
          <ul className="mail-list">
            {aliases === "loading" ? (
              <li className="muted">Loading…</li>
            ) : aliases.length === 0 ? (
              <li className="muted">No aliases yet.</li>
            ) : (
              aliases.map((al) => (
                <li key={al.id} className="mail-list-row">
                  <span className="mono">
                    {al.alias}@{domain.fqdn}
                  </span>
                  <span className="muted mono">→ {al.destinations.join(", ")}</span>
                  <span className="mail-spacer" />
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void delAlias(al)}
                    aria-label={`Delete alias ${al.alias}@${domain.fqdn}`}
                  >
                    Delete
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {pw && (
        <PasswordDialog address={pw.address} password={pw.password} onClose={() => setPw(null)} />
      )}
    </li>
  );
}

// ── instance card ───────────────────────────────────────────────────────────

function InstanceCard({ instance }: { instance: MailInstance }) {
  const [domains, setDomains] = useState<MailDomain[] | null>(null);
  const [fqdn, setFqdn] = useState("");
  const [dnsMode, setDnsMode] = useState<"hint" | "auto">("hint");
  const [fqdnErr, setFqdnErr] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<MailDomain[]>(`/api/v1/mail/instances/${instance.id}/domains`);
    setDomains(r.ok && Array.isArray(r.data) ? r.data : []);
  }, [instance.id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function addDomain(e: FormEvent) {
    e.preventDefault();
    const v = fqdn.trim().toLowerCase();
    if (!isValidFqdn(v)) {
      setFqdnErr("Enter a valid domain, e.g. example.com");
      return;
    }
    setFqdnErr("");
    setAdding(true);
    const r = await api.post(`/api/v1/mail/instances/${instance.id}/domains`, { fqdn: v, dnsMode });
    setAdding(false);
    if (r.ok) {
      toast.success("Domain added");
      setFqdn("");
      void load();
    } else {
      toast.error(`Could not add domain (${r.status}).`);
    }
  }

  const ptr = instance.ptrOk === null ? "PTR unknown" : instance.ptrOk ? "PTR ok" : "PTR mismatch";

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="mono">{instance.hostname}</h2>
        <StatusPill status={instance.status} />
      </div>
      <div className="mail-badges muted">
        <span title="outbound SMTP (port 25) egress">port 25: {instance.port25Egress}</span>
        <span title="reverse DNS for the mail host">{ptr}</span>
      </div>
      <form className="mail-add" onSubmit={(e) => void addDomain(e)}>
        <div className="mail-add-field">
          <input
            aria-label="New mail domain"
            aria-invalid={fqdnErr ? true : undefined}
            placeholder="example.com"
            value={fqdn}
            onChange={(e) => setFqdn(e.target.value)}
          />
          {fqdnErr && <span className="field-error">{fqdnErr}</span>}
        </div>
        <select
          aria-label="DNS mode"
          value={dnsMode}
          onChange={(e) => setDnsMode(e.target.value === "auto" ? "auto" : "hint")}
        >
          <option value="hint">Manual DNS (show records)</option>
          <option value="auto">Automatic DNS (publish for me)</option>
        </select>
        <button className="btn btn-primary btn-sm" disabled={adding}>
          {adding ? "Adding…" : "Add domain"}
        </button>
      </form>
      {domains === null ? (
        <SkeletonRows count={2} />
      ) : domains.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>
          No domains yet — add one to publish DNS and create mailboxes.
        </p>
      ) : (
        <ul className="mail-domains">
          {domains.map((d) => (
            <DomainRow key={d.id} domain={d} />
          ))}
        </ul>
      )}
    </section>
  );
}

// ── workspace ────────────────────────────────────────────────────────────────

export function Mail() {
  const [instances, setInstances] = useState<MailInstance[] | null>(null);
  const [note, setNote] = useState("");
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<MailInstance[]>("/api/v1/mail/instances");
    if (r.ok && Array.isArray(r.data)) {
      setInstances(r.data);
      setNote("");
    } else {
      setInstances([]);
      setNote(`Mail API responded ${r.status}.`);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    document.title = pageTitle("Email");
  }, []);

  return (
    <>
      <Page
        title="Email"
        subtitle="Managed mailboxes on your domain — add a domain, verify DNS, and create inboxes."
        actions={
          instances && instances.length > 0 ? (
            <button className="btn btn-primary btn-sm" onClick={() => setConnecting(true)}>
              Connect mail server
            </button>
          ) : undefined
        }
      >
        {instances === null ? (
          <div className="card">
            <SkeletonRows count={3} />
          </div>
        ) : instances.length === 0 ? (
          <EmptyState
            title="No mail server yet"
            description={
              note ||
              "Connect an installed Stalwart server to host email on your domain, or deploy one from the catalog first."
            }
            action={
              <button className="btn btn-primary btn-sm" onClick={() => setConnecting(true)}>
                Connect mail server
              </button>
            }
          />
        ) : (
          instances.map((inst) => <InstanceCard key={inst.id} instance={inst} />)
        )}
      </Page>

      {connecting && (
        <ConnectInstanceModal
          onClose={() => setConnecting(false)}
          onConnected={() => {
            setConnecting(false);
            void load();
          }}
        />
      )}
    </>
  );
}
