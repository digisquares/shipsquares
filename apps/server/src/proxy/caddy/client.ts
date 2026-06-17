import type { CaddyConfig } from "./config.js";

// Runtime Caddy admin-API client (08-proxy-ssl.md). The pure config builder
// (config.ts) produces desired state; this POSTs it to Caddy's admin endpoint
// (loopback :2019 by default). `/load` atomically replaces the running config;
// since the unit runs `caddy run --resume`, the loaded config is autosaved and
// survives a Caddy restart.
//
// Caddy's admin API enforces an origin allow-list: a request whose `Origin`
// isn't allowed (including the empty Origin that Node's fetch sends) gets 403.
// We send Origin = the admin URL, which Caddy's default origins (the listen
// host:port) accept, so programmatic access is authorized.
export class CaddyAdminClient {
  constructor(private readonly adminUrl: string) {}

  private baseHeaders(): Record<string, string> {
    return { Origin: this.adminUrl };
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.adminUrl}/config/`, { headers: this.baseHeaders() });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** POST /load. `config` carries the apps block plus an admin block so the
   *  origin allow-list survives the atomic replace. */
  async load(config: CaddyConfig & { admin?: unknown }): Promise<void> {
    const res = await fetch(`${this.adminUrl}/load`, {
      method: "POST",
      headers: { ...this.baseHeaders(), "content-type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`caddy /load failed: ${res.status} ${detail}`);
    }
  }

  async getConfig(): Promise<unknown> {
    const res = await fetch(`${this.adminUrl}/config/`, { headers: this.baseHeaders() });
    return res.ok ? res.json() : null;
  }
}
