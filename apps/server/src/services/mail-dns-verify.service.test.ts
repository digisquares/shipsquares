import { describe, expect, it } from "vitest";

import {
  type ResolveFn,
  type VerifiableRecord,
  verifyDomainRecords,
} from "./mail-dns-verify.service.js";

// The required record set for acme.com, as persisted by addDomain.
const records: VerifiableRecord[] = [
  { id: "r_mx", kind: "mx", name: "acme.com.", type: "MX", value: "mx.acme.com.", priority: 10 },
  {
    id: "r_spf",
    kind: "spf",
    name: "acme.com.",
    type: "TXT",
    value: "v=spf1 mx -all",
    priority: null,
  },
  {
    id: "r_dkim",
    kind: "dkim",
    name: "default._domainkey.acme.com.",
    type: "TXT",
    value: "v=DKIM1; p=KEY",
    priority: null,
  },
  {
    id: "r_dmarc",
    kind: "dmarc",
    name: "_dmarc.acme.com.",
    type: "TXT",
    value: "v=DMARC1; p=reject",
    priority: null,
  },
];

/** A fake resolver driven by a name→values map; unknown names resolve empty. */
const resolverFrom =
  (map: Record<string, string[]>): ResolveFn =>
  (name) =>
    Promise.resolve(map[name.replace(/\.$/, "")] ?? []);

const allAligned: Record<string, string[]> = {
  "acme.com": ["mx.acme.com", "v=spf1 mx -all"], // MX + SPF share the apex name
  "default._domainkey.acme.com": ["v=DKIM1; p=KEY"],
  "_dmarc.acme.com": ["v=DMARC1; p=reject"],
};

describe("verifyDomainRecords", () => {
  it("marks every record verified and the domain verified when all align", async () => {
    const out = await verifyDomainRecords(records, resolverFrom(allAligned));
    expect(out.domainStatus).toBe("verified");
    expect(out.records.every((r) => r.status === "verified")).toBe(true);
  });

  it("fails the domain when a required record is missing (DKIM not published)", async () => {
    const { "default._domainkey.acme.com": _omit, ...partial } = allAligned;
    const out = await verifyDomainRecords(records, resolverFrom(partial));
    expect(out.domainStatus).toBe("failed");
    const dkim = out.records.find((r) => r.id === "r_dkim");
    expect(dkim?.status).toBe("failed");
    expect(dkim?.detail).toBeTruthy();
  });

  it("fails when MX points elsewhere", async () => {
    const out = await verifyDomainRecords(
      records,
      resolverFrom({ ...allAligned, "acme.com": ["other-mx.example.", "v=spf1 mx -all"] }),
    );
    expect(out.domainStatus).toBe("failed");
    expect(out.records.find((r) => r.id === "r_mx")?.status).toBe("failed");
  });

  it("nothing resolved → all required fail (domain failed)", async () => {
    const out = await verifyDomainRecords(records, resolverFrom({}));
    expect(out.domainStatus).toBe("failed");
  });
});
