import { describe, expect, it } from "vitest";

import {
  classifyRecord,
  extractPriority,
  normalizeStalwartRecords,
  REQUIRED_KINDS,
  type RawDnsRecord,
} from "./records.js";

describe("classifyRecord", () => {
  it("classifies by DNS type for MX/CAA/TLSA/SRV", () => {
    expect(classifyRecord("MX", "acme.com", "10 mx.acme.com.")).toBe("mx");
    expect(classifyRecord("caa", "acme.com", '0 issue "letsencrypt.org"')).toBe("caa");
    expect(classifyRecord("TLSA", "_25._tcp.mx.acme.com", "3 1 1 abc")).toBe("tlsa");
    expect(classifyRecord("SRV", "_submission._tcp.acme.com", "0 1 587 mail.acme.com.")).toBe(
      "srv",
    );
  });

  it("classifies TXT records by name then content", () => {
    expect(classifyRecord("TXT", "_dmarc.acme.com", "v=DMARC1; p=reject")).toBe("dmarc");
    expect(classifyRecord("TXT", "default._domainkey.acme.com", "v=DKIM1; p=MIGf")).toBe("dkim");
    expect(classifyRecord("TXT", "acme.com", "v=spf1 mx -all")).toBe("spf");
    expect(classifyRecord("TXT", "_mta-sts.acme.com", "v=STSv1; id=123")).toBe("mta_sts");
    expect(classifyRecord("TXT", "_smtp._tls.acme.com", "v=TLSRPTv1; rua=...")).toBe("tls_rpt");
  });

  it("classifies CNAME by host prefix", () => {
    expect(classifyRecord("CNAME", "autodiscover.acme.com", "mail.acme.com")).toBe("autodiscover");
    expect(classifyRecord("CNAME", "autoconfig.acme.com", "mail.acme.com")).toBe("autoconfig");
    expect(classifyRecord("CNAME", "mta-sts.acme.com", "mail.acme.com")).toBe("mta_sts");
  });
});

describe("extractPriority", () => {
  it("prefers an explicit priority and leaves content intact", () => {
    expect(extractPriority("mx.acme.com.", 10)).toEqual({ value: "mx.acme.com.", priority: 10 });
  });
  it("parses a leading integer when no explicit priority", () => {
    expect(extractPriority("10 mx.acme.com.")).toEqual({ value: "mx.acme.com.", priority: 10 });
    expect(extractPriority("0 1 587 mail.acme.com.")).toEqual({
      value: "1 587 mail.acme.com.",
      priority: 0,
    });
  });
  it("returns null priority when none present", () => {
    expect(extractPriority("mx.acme.com.")).toEqual({ value: "mx.acme.com.", priority: null });
  });
});

describe("normalizeStalwartRecords", () => {
  const raw: RawDnsRecord[] = [
    { type: "mx", name: "acme.com.", content: "10 mx.acme.com." },
    { type: "txt", name: "acme.com.", content: "v=spf1 mx -all" },
    { type: "txt", name: "default._domainkey.acme.com.", content: "v=DKIM1; p=MIGf" },
    { type: "txt", name: "_dmarc.acme.com.", content: "v=DMARC1; p=reject" },
  ];

  it("maps every raw record to the normalized shape", () => {
    const out = normalizeStalwartRecords(raw);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({
      kind: "mx",
      name: "acme.com.",
      type: "MX",
      value: "mx.acme.com.",
      priority: 10,
    });
    expect(out.map((r) => r.kind)).toEqual(["mx", "spf", "dkim", "dmarc"]);
  });

  it("only MX/SRV carry a parsed priority; TXT priority stays null", () => {
    const out = normalizeStalwartRecords(raw);
    expect(out[1]!.priority).toBeNull();
    expect(out[2]!.priority).toBeNull();
  });

  it("covers all four required kinds in a typical set", () => {
    const kinds = new Set(normalizeStalwartRecords(raw).map((r) => r.kind));
    for (const k of REQUIRED_KINDS) expect(kinds.has(k)).toBe(true);
  });
});
