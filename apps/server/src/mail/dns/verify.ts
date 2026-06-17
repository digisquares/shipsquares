/**
 * DNS verification (R9 · mail/03-dns-and-provisioning.md). Pure alignment checks:
 * given an expected record and the values *observed* at its name (the verify job
 * supplies the real resolver lookups), decide whether it is verified. A domain
 * rolls up to `verified` only when every required kind (MX/SPF/DKIM/DMARC)
 * aligns. No I/O here — resolver results are injected so this is unit-testable.
 */

import type { MailDnsRecordKind, NormalizedDnsRecord } from "./records.js";
import { REQUIRED_KINDS } from "./records.js";

export type RecordStatus = "verifying" | "verified" | "failed";
export type DomainStatus = "pending" | "verifying" | "verified" | "failed";

/** Values observed at a record's name for its type (e.g. all TXT strings). */
export interface Observed {
  values: string[];
}

export interface RecordVerdict {
  kind: MailDnsRecordKind;
  name: string;
  status: RecordStatus;
  detail?: string;
}

const canon = (s: string): string => s.trim().toLowerCase().replace(/\.$/, "");

/** Extract the `p=` public-key token from a DKIM TXT value, ignoring whitespace. */
function dkimKey(txt: string): string | null {
  const m = /p=([A-Za-z0-9+/=]+)/.exec(txt.replace(/\s+/g, ""));
  return m ? m[1]! : null;
}

/**
 * Verify one expected record against the values observed at its name. Required
 * kinds fail when absent; advisory kinds stay `verifying` (never block go-live).
 */
export function verifyRecord(expected: NormalizedDnsRecord, observed: Observed): RecordVerdict {
  const required = REQUIRED_KINDS.includes(expected.kind);
  const miss = (detail: string): RecordVerdict => ({
    kind: expected.kind,
    name: expected.name,
    status: required ? "failed" : "verifying",
    detail,
  });
  const ok: RecordVerdict = { kind: expected.kind, name: expected.name, status: "verified" };

  const values = observed.values.map((v) => v.trim()).filter((v) => v.length > 0);
  if (values.length === 0) return miss(`no ${expected.type} record found at ${expected.name}`);

  switch (expected.kind) {
    case "mx": {
      const want = canon(expected.value);
      return values.some((v) => canon(v) === want)
        ? ok
        : miss(`MX does not point at ${expected.value}`);
    }
    case "spf": {
      const spf = values.find((v) => v.toLowerCase().startsWith("v=spf1"));
      if (!spf) return miss("no v=spf1 record present");
      // Every non-version mechanism we expect must appear in the published SPF.
      const expectedMechs = expected.value.split(/\s+/).filter((m) => m && !/^v=spf1$/i.test(m));
      const published = spf.toLowerCase();
      const missing = expectedMechs.filter((m) => !published.includes(m.toLowerCase()));
      return missing.length === 0 ? ok : miss(`SPF missing: ${missing.join(", ")}`);
    }
    case "dkim": {
      const want = dkimKey(expected.value);
      const got = values.map(dkimKey).find((k) => k !== null) ?? null;
      if (!got) return miss("no DKIM public key published");
      return want && got === want ? ok : miss("DKIM public key mismatch");
    }
    case "dmarc": {
      return values.some((v) => v.toLowerCase().startsWith("v=dmarc1"))
        ? ok
        : miss("no v=DMARC1 policy present");
    }
    default: {
      // Advisory kinds (mta_sts, tls_rpt, tlsa, caa, autoconfig, …): present-is-good.
      return ok;
    }
  }
}

/**
 * Roll per-record verdicts up to a domain status. Verified iff every required
 * kind is verified; failed iff a required kind failed; otherwise verifying;
 * pending when there are no verdicts yet.
 */
export function rollupDomainStatus(verdicts: readonly RecordVerdict[]): DomainStatus {
  if (verdicts.length === 0) return "pending";
  const required = verdicts.filter((v) => REQUIRED_KINDS.includes(v.kind));
  if (required.length === 0) return "verifying";
  if (required.some((v) => v.status === "failed")) return "failed";
  return required.every((v) => v.status === "verified") ? "verified" : "verifying";
}
