// Pluggable proxy driver abstraction (08-proxy-ssl.md). Caddy is the default;
// traefik/nginx are interface stubs. The control plane keeps desired state in
// Postgres and converges the proxy to it.

export type ProxyType = "caddy" | "traefik" | "nginx" | "none";

export interface RouteTarget {
  /** upstream the proxy forwards to, e.g. "app_42:3000" or "127.0.0.1:8080" */
  upstream: string;
  websockets?: boolean; // Caddy passes Upgrade automatically; informational
  stripPathPrefix?: string;
}

export interface DesiredApp {
  appId: string;
  hosts: string[]; // fqdns from the domains table
  target: RouteTarget;
  forceHttps?: boolean;
  hsts?: boolean;
}

export interface DesiredDomain {
  fqdn: string;
  managed: "auto" | "on-demand"; // owned -> auto; custom -> on-demand
}

export interface DesiredRedirect {
  id: string;
  fromHosts: string[];
  toTarget: string;
  permanent: boolean; // 308 vs 302
}

export interface DesiredBasicAuth {
  username: string;
  /** bcrypt hash (from password_secret_ref, 11) — never the plaintext. */
  bcryptHash: string;
}

export interface DesiredCustomCert {
  domain: string;
  certPem: string;
  keyPem: string;
}

export interface CertState {
  fqdn: string;
  status: "none" | "pending" | "issuing" | "issued" | "error" | "expiring";
  notAfter?: string;
  lastError?: string;
}

export interface ProxyDriver {
  readonly type: ProxyType;
  converge(input: { apps: DesiredApp[]; domains: DesiredDomain[] }): Promise<void>;
  upsertApp(app: DesiredApp, domains: DesiredDomain[]): Promise<void>;
  removeApp(appId: string): Promise<void>;
  certStates(fqdns: string[]): Promise<CertState[]>;
  ping(): Promise<boolean>;
}

export function routeId(appId: string): string {
  return `app_${appId}`;
}
