import { describe, expect, it } from "vitest";

import {
  assessPreflight,
  decidePort25Egress,
  summarizeDnsbl,
  verifyPtr,
  type PreflightInput,
} from "./preflight.js";

describe("decidePort25Egress", () => {
  it("maps probe outcomes to egress status", () => {
    expect(decidePort25Egress({ attempted: true, connected: true })).toBe("ok");
    expect(decidePort25Egress({ attempted: true, connected: false })).toBe("blocked");
    expect(decidePort25Egress({ attempted: false, connected: false })).toBe("unknown");
  });
});

describe("verifyPtr", () => {
  it("ok when PTR matches the MX FQDN (dot/case-insensitive)", () => {
    expect(verifyPtr("mx.acme.com", "MX.ACME.COM.").ok).toBe(true);
  });
  it("fails on missing PTR", () => {
    const v = verifyPtr("mx.acme.com", null);
    expect(v.ok).toBe(false);
    expect(v.detail).toContain("no PTR");
  });
  it("fails on mismatch and reports both names", () => {
    const v = verifyPtr("mx.acme.com", "host-1-2-3-4.cloud.example");
    expect(v.ok).toBe(false);
    expect(v.detail).toContain("expected mx.acme.com");
  });
});

describe("summarizeDnsbl", () => {
  it("clean when listed nowhere", () => {
    expect(
      summarizeDnsbl([
        { zone: "zen.spamhaus.org", listed: false },
        { zone: "bl.spamcop.net", listed: false },
      ]),
    ).toEqual({ clean: true, listedOn: [] });
  });
  it("reports the zones an IP is listed on", () => {
    expect(
      summarizeDnsbl([
        { zone: "zen.spamhaus.org", listed: true },
        { zone: "bl.spamcop.net", listed: false },
      ]),
    ).toEqual({ clean: false, listedOn: ["zen.spamhaus.org"] });
  });
});

describe("assessPreflight", () => {
  const base: PreflightInput = {
    port25: "ok",
    ptr: { ok: true },
    dnsbl: { clean: true, listedOn: [] },
    relayConfigured: false,
  };

  it("ready when everything is green", () => {
    const r = assessPreflight(base);
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("blocked port 25 is a blocker without a relay, fine with one", () => {
    expect(assessPreflight({ ...base, port25: "blocked" }).ready).toBe(false);
    expect(assessPreflight({ ...base, port25: "blocked", relayConfigured: true }).ready).toBe(true);
  });

  it("PTR mismatch is always a blocker", () => {
    const r = assessPreflight({ ...base, ptr: { ok: false, detail: "PTR is wrong" } });
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain("PTR is wrong");
  });

  it("DNSBL listing and unknown egress are warnings, not blockers", () => {
    const r = assessPreflight({
      ...base,
      port25: "unknown",
      dnsbl: { clean: false, listedOn: ["zen.spamhaus.org"] },
    });
    expect(r.ready).toBe(true);
    expect(r.warnings).toHaveLength(2);
  });
});
