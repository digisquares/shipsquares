/**
 * Stalwart management-API client (R9 · mail/01-architecture.md). The *only*
 * thing that talks to Stalwart — the WebAdmin and stalwart-cli are clients of
 * this same API, so ShipSquares is just another one. Bearer-authed with the
 * sealed admin token (resolved by the caller). Paths target a pinned Stalwart
 * version; keeping them behind this adapter means a version bump is a single
 * seam to update. Calls are create-or-update by identifier where possible so the
 * reconcile job and retries are safe.
 */

import type {
  CreateMailboxInput,
  DkimKey,
  DnsProviderConfig,
  RawDnsRecord,
  StalwartClientOptions,
} from "./types.js";

export class StalwartClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: StalwartClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`stalwart ${method} ${path} failed: ${res.status} ${detail}`.trim());
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Liveness check against the management API. */
  async ping(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/principal?type=domain`, {
        headers: { authorization: `Bearer ${this.token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Domains ──────────────────────────────────────────────────────────────
  async createDomain(fqdn: string): Promise<void> {
    await this.request("POST", "/api/principal", { type: "domain", name: fqdn });
  }

  async listDomains(): Promise<string[]> {
    const data = await this.request<{ items?: { name: string }[] }>(
      "GET",
      "/api/principal?type=domain",
    );
    return (data.items ?? []).map((d) => d.name);
  }

  async deleteDomain(fqdn: string): Promise<void> {
    await this.request("DELETE", `/api/principal/${encodeURIComponent(fqdn)}`);
  }

  // ── Mailboxes (principals) ────────────────────────────────────────────────
  async createMailbox(input: CreateMailboxInput): Promise<void> {
    await this.request("POST", "/api/principal", {
      type: "individual",
      name: input.email,
      emails: [input.email],
      secrets: [input.password],
      description: input.displayName,
      quota: input.quotaBytes,
    });
  }

  async listMailboxes(): Promise<string[]> {
    const data = await this.request<{ items?: { name: string }[] }>(
      "GET",
      "/api/principal?type=individual",
    );
    return (data.items ?? []).map((m) => m.name);
  }

  async deleteMailbox(email: string): Promise<void> {
    await this.request("DELETE", `/api/principal/${encodeURIComponent(email)}`);
  }

  /** Reset a mailbox password. The new secret is set here; we never store it. */
  async setMailboxPassword(email: string, password: string): Promise<void> {
    await this.request("PATCH", `/api/principal/${encodeURIComponent(email)}`, [
      { action: "set", field: "secrets", value: [password] },
    ]);
  }

  // ── DKIM ──────────────────────────────────────────────────────────────────
  async generateDkim(domain: string): Promise<DkimKey> {
    return this.request<DkimKey>("POST", "/api/dkim", { domain });
  }

  // ── DNS ─────────────────────────────────────────────────────────────────
  /** The required records Stalwart computes for a domain (feeds normalize). */
  async getDnsRecords(domain: string): Promise<RawDnsRecord[]> {
    const data = await this.request<{ records?: RawDnsRecord[] } | RawDnsRecord[]>(
      "GET",
      `/api/dns/records/${encodeURIComponent(domain)}`,
    );
    return Array.isArray(data) ? data : (data.records ?? []);
  }

  /** Enable auto-publish: write the DNS-provider config Stalwart syncs through. */
  async setDnsProvider(provider: DnsProviderConfig): Promise<void> {
    await this.request("POST", "/api/settings", {
      "dns.provider.type": provider.type,
      ...Object.fromEntries(
        Object.entries(provider.credentials).map(([k, v]) => [`dns.provider.${k}`, v]),
      ),
    });
  }

  /** Apply pending config from the datastore without a restart. */
  async reload(): Promise<void> {
    await this.request("GET", "/api/reload");
  }
}
