/**
 * DNS record normalization (R9 · mail/03-dns-and-provisioning.md). Pure
 * functions that turn the raw record set Stalwart computes for a domain into the
 * ShipSquares `mail_dns_records` model — classifying each record's *kind* from
 * its (type, name, content) and extracting MX/SRV priority. The UI badges and
 * the verify job both consume the normalized shape; nothing here does I/O.
 */

export type MailDnsRecordKind =
  | "mx"
  | "spf"
  | "dkim"
  | "dmarc"
  | "tlsa"
  | "mta_sts"
  | "tls_rpt"
  | "caa"
  | "autoconfig"
  | "autodiscover"
  | "srv";

/** A record as returned by Stalwart's per-domain DNS endpoint. */
export interface RawDnsRecord {
  type: string; // "MX" | "TXT" | "CNAME" | "SRV" | "CAA" | "TLSA"
  name: string; // host, possibly FQDN with trailing dot
  content: string; // record value
  priority?: number; // some sources separate MX/SRV priority from content
}

/** The normalized shape that maps 1:1 onto a `mail_dns_records` row. */
export interface NormalizedDnsRecord {
  kind: MailDnsRecordKind;
  name: string;
  type: string;
  value: string;
  priority: number | null;
}

/** Required records — a domain is only "verified" once all of these align. */
export const REQUIRED_KINDS: readonly MailDnsRecordKind[] = ["mx", "spf", "dkim", "dmarc"];

const lc = (s: string): string => s.trim().toLowerCase();

/**
 * Classify a record's purpose from its DNS type, name, and content. Deterministic
 * — Stalwart returns generic DNS records, so we infer the mail kind here.
 */
export function classifyRecord(type: string, name: string, content: string): MailDnsRecordKind {
  const t = type.trim().toUpperCase();
  const n = lc(name);
  const c = lc(content);

  switch (t) {
    case "MX":
      return "mx";
    case "CAA":
      return "caa";
    case "TLSA":
      return "tlsa";
    case "SRV":
      return "srv";
    case "CNAME":
      if (n.startsWith("autodiscover")) return "autodiscover";
      if (n.startsWith("autoconfig")) return "autoconfig";
      if (n.startsWith("mta-sts")) return "mta_sts";
      // Fall through to a best-effort default for unrecognized CNAMEs.
      return "autoconfig";
    case "TXT":
      if (n.startsWith("_dmarc")) return "dmarc";
      if (n.startsWith("_mta-sts")) return "mta_sts";
      if (n.startsWith("_smtp._tls")) return "tls_rpt";
      if (n.includes("._domainkey")) return "dkim";
      if (c.startsWith("v=spf1")) return "spf";
      if (c.startsWith("v=dmarc1")) return "dmarc";
      if (c.startsWith("v=dkim1")) return "dkim";
      // An unclassifiable TXT is most often the SPF record without a clear name.
      return "spf";
    default:
      // Unknown type — treat as advisory CAA-like; the verifier marks it non-required.
      return "caa";
  }
}

/**
 * Parse an MX/SRV `content` whose priority may be embedded as a leading integer
 * (e.g. "10 mx.acme.com." or "0 1 587 mail.acme.com."). Returns the priority and
 * the value with the leading priority stripped. If `explicit` is provided it
 * wins and the content is returned unchanged.
 */
export function extractPriority(
  content: string,
  explicit?: number,
): { value: string; priority: number | null } {
  if (explicit !== undefined) return { value: content.trim(), priority: explicit };
  const trimmed = content.trim();
  const m = /^(\d+)\s+(.*)$/.exec(trimmed);
  if (m) return { value: m[2]!.trim(), priority: Number(m[1]) };
  return { value: trimmed, priority: null };
}

/** Normalize a raw Stalwart record set into the `mail_dns_records` shape. */
export function normalizeStalwartRecords(raw: readonly RawDnsRecord[]): NormalizedDnsRecord[] {
  return raw.map((r) => {
    const kind = classifyRecord(r.type, r.name, r.content);
    const carriesPriority = kind === "mx" || kind === "srv";
    const { value, priority } = carriesPriority
      ? extractPriority(r.content, r.priority)
      : { value: r.content.trim(), priority: r.priority ?? null };
    return { kind, name: r.name.trim(), type: r.type.trim().toUpperCase(), value, priority };
  });
}
