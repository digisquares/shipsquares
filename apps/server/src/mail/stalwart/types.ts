/**
 * Stalwart management-API types (R9 · mail/01-architecture.md). The shapes the
 * client sends/receives. These target a *pinned* Stalwart version behind the
 * client's thin adapter; Stalwart's admin surface has shifted across releases
 * (`/api/*` REST → JMAP-style management objects in 0.16+), so contract drift is
 * isolated to the client, never leaking into callers.
 */

import type { RawDnsRecord } from "../dns/records.js";

export interface StalwartClientOptions {
  /** Base URL of the Stalwart management API, e.g. https://mail.acme.com */
  baseUrl: string;
  /** Bearer token / admin secret — resolved from the sealed ref by the caller. */
  token: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** A mailbox to create. The password is set in Stalwart and never stored by us. */
export interface CreateMailboxInput {
  email: string;
  displayName?: string;
  quotaBytes?: number;
  password: string;
}

export interface DkimKey {
  selector: string;
  publicKey: string;
}

/** Supported DNS-provider integrations Stalwart can publish + sync through. */
export type DnsProviderType =
  | "cloudflare"
  | "route53"
  | "google"
  | "digitalocean"
  | "ovh"
  | "rfc2136";

export interface DnsProviderConfig {
  type: DnsProviderType;
  /** Provider-specific credentials (sealed before reaching here). */
  credentials: Record<string, string>;
}

export type { RawDnsRecord };
