import { describe, expect, it } from "vitest";

import type { NormalizedDnsRecord } from "./records.js";
import { rollupDomainStatus, verifyRecord, type RecordVerdict } from "./verify.js";

const rec = (over: Partial<NormalizedDnsRecord>): NormalizedDnsRecord => ({
  kind: "mx",
  name: "acme.com.",
  type: "MX",
  value: "mx.acme.com.",
  priority: 10,
  ...over,
});

describe("verifyRecord", () => {
  it("MX verifies when an observed exchange matches (dot/case-insensitive)", () => {
    expect(verifyRecord(rec({}), { values: ["MX.ACME.COM"] }).status).toBe("verified");
  });
  it("MX fails when no observed value matches", () => {
    const v = verifyRecord(rec({}), { values: ["other.host."] });
    expect(v.status).toBe("failed");
    expect(v.detail).toContain("mx.acme.com");
  });

  it("SPF verifies only when all expected mechanisms are present", () => {
    const spf = rec({ kind: "spf", type: "TXT", value: "v=spf1 mx include:relay.io -all" });
    expect(verifyRecord(spf, { values: ["v=spf1 mx include:relay.io -all"] }).status).toBe(
      "verified",
    );
    expect(verifyRecord(spf, { values: ["v=spf1 mx -all"] }).status).toBe("failed");
  });

  it("DKIM verifies on matching p= key and fails on mismatch", () => {
    const dkim = rec({
      kind: "dkim",
      name: "default._domainkey.acme.com.",
      type: "TXT",
      value: "v=DKIM1; k=rsa; p=AAAB3Key",
    });
    expect(verifyRecord(dkim, { values: ["v=DKIM1; p=AAAB3Key"] }).status).toBe("verified");
    expect(verifyRecord(dkim, { values: ["v=DKIM1; p=DIFFERENT"] }).status).toBe("failed");
  });

  it("DMARC verifies when a v=DMARC1 policy is present", () => {
    const dmarc = rec({
      kind: "dmarc",
      name: "_dmarc.acme.com.",
      type: "TXT",
      value: "v=DMARC1; p=none",
    });
    expect(verifyRecord(dmarc, { values: ["v=DMARC1; p=reject"] }).status).toBe("verified");
  });

  it("required kind with no values fails; advisory kind stays verifying", () => {
    expect(verifyRecord(rec({}), { values: [] }).status).toBe("failed");
    const mta = rec({ kind: "mta_sts", type: "TXT", value: "v=STSv1; id=1" });
    expect(verifyRecord(mta, { values: [] }).status).toBe("verifying");
  });

  it("advisory kind is verified when present", () => {
    const mta = rec({ kind: "mta_sts", type: "TXT", value: "v=STSv1; id=1" });
    expect(verifyRecord(mta, { values: ["v=STSv1; id=1"] }).status).toBe("verified");
  });
});

describe("rollupDomainStatus", () => {
  const v = (kind: RecordVerdict["kind"], status: RecordVerdict["status"]): RecordVerdict => ({
    kind,
    name: `${kind}.acme.com`,
    status,
  });

  it("pending with no verdicts", () => {
    expect(rollupDomainStatus([])).toBe("pending");
  });
  it("verified only when all required kinds are verified", () => {
    expect(
      rollupDomainStatus([
        v("mx", "verified"),
        v("spf", "verified"),
        v("dkim", "verified"),
        v("dmarc", "verified"),
        v("mta_sts", "verifying"), // advisory does not block
      ]),
    ).toBe("verified");
  });
  it("failed when a required kind failed", () => {
    expect(rollupDomainStatus([v("mx", "verified"), v("dkim", "failed")])).toBe("failed");
  });
  it("verifying when required kinds are still in progress", () => {
    expect(rollupDomainStatus([v("mx", "verified"), v("spf", "verifying")])).toBe("verifying");
  });
  it("verifying when only advisory verdicts exist", () => {
    expect(rollupDomainStatus([v("mta_sts", "verified")])).toBe("verifying");
  });
});
