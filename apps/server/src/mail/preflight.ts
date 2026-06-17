/**
 * Deliverability preflight (R9 · mail/03-dns-and-provisioning.md). Pure
 * decisions over probe results the job supplies: outbound port-25 egress,
 * reverse-DNS (PTR) match for the MX FQDN, and DNSBL membership. These are the
 * checks the setup wizard surfaces as green/amber/red tiles. PTR and port-25
 * cannot be set via a zone API, so they are detection (Phase 1) → remediation
 * (Phase 3, smarthost/relay). No I/O here.
 */

export type EgressStatus = "ok" | "blocked" | "unknown";

/** Result of attempting an outbound TCP connect to a public MX on port 25. */
export interface Port25ProbeResult {
  attempted: boolean; // false ⇒ we couldn't run the probe
  connected: boolean; // true ⇒ a 25/tcp connection succeeded
  error?: string;
}

export function decidePort25Egress(probe: Port25ProbeResult): EgressStatus {
  if (!probe.attempted) return "unknown";
  return probe.connected ? "ok" : "blocked";
}

const canonHost = (s: string): string => s.trim().toLowerCase().replace(/\.$/, "");

export interface PtrVerdict {
  ok: boolean;
  detail?: string;
}

/**
 * The IP's reverse DNS must resolve to the MX FQDN (dot/case-insensitive). A
 * mismatch or missing PTR is the single most common cause of rejected mail.
 */
export function verifyPtr(expectedHostname: string, observedPtr: string | null): PtrVerdict {
  if (!observedPtr || observedPtr.trim() === "") {
    return { ok: false, detail: "no PTR (reverse DNS) record set for the mail IP" };
  }
  if (canonHost(observedPtr) !== canonHost(expectedHostname)) {
    return { ok: false, detail: `PTR is ${observedPtr.trim()}, expected ${expectedHostname}` };
  }
  return { ok: true };
}

export interface DnsblResult {
  zone: string; // the blocklist queried, e.g. "zen.spamhaus.org"
  listed: boolean;
}

export interface DnsblSummary {
  clean: boolean;
  listedOn: string[];
}

/** Summarize DNSBL lookups: clean only when listed on zero blocklists. */
export function summarizeDnsbl(results: readonly DnsblResult[]): DnsblSummary {
  const listedOn = results.filter((r) => r.listed).map((r) => r.zone);
  return { clean: listedOn.length === 0, listedOn };
}

export interface PreflightInput {
  port25: EgressStatus;
  ptr: PtrVerdict;
  dnsbl: DnsblSummary;
  relayConfigured: boolean; // a smarthost makes blocked port-25 non-fatal
}

export interface PreflightReport {
  /** Safe to send external mail with good odds of inbox placement. */
  ready: boolean;
  blockers: string[];
  warnings: string[];
}

/**
 * Roll the individual checks into a go-live report. Port-25 blocked is a blocker
 * *unless* a relay is configured; PTR mismatch is always a blocker; a DNSBL
 * listing is a warning (delivery degrades but is not impossible).
 */
export function assessPreflight(input: PreflightInput): PreflightReport {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (input.port25 === "blocked" && !input.relayConfigured) {
    blockers.push("outbound port 25 is blocked and no smarthost/relay is configured");
  } else if (input.port25 === "unknown") {
    warnings.push("outbound port 25 egress could not be determined");
  }

  if (!input.ptr.ok) blockers.push(input.ptr.detail ?? "reverse DNS (PTR) does not match");

  if (!input.dnsbl.clean) {
    warnings.push(`IP is listed on: ${input.dnsbl.listedOn.join(", ")}`);
  }

  return { ready: blockers.length === 0, blockers, warnings };
}
