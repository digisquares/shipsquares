import { describe, expect, it } from "vitest";

import { assertHostAllowed, hostLiteralBlocked, ipBlocked } from "./ssrf.js";

describe("ipBlocked", () => {
  it("blocks loopback, private, link-local/metadata, CGNAT", () => {
    expect(ipBlocked("127.0.0.1")).toMatch(/loopback/);
    expect(ipBlocked("10.0.0.5")).toMatch(/private/);
    expect(ipBlocked("172.16.3.4")).toMatch(/private/);
    expect(ipBlocked("172.32.0.1")).toBeNull(); // outside 16–31
    expect(ipBlocked("192.168.1.1")).toMatch(/private/);
    expect(ipBlocked("169.254.169.254")).toMatch(/link-local|metadata/);
    expect(ipBlocked("100.64.0.1")).toMatch(/NAT/);
  });

  it("allows public addresses", () => {
    expect(ipBlocked("8.8.8.8")).toBeNull();
    expect(ipBlocked("203.0.113.10")).toBeNull();
  });

  it("handles IPv6 loopback, ULA, link-local, and ipv4-mapped", () => {
    expect(ipBlocked("::1")).toMatch(/loopback/);
    expect(ipBlocked("fd00::1")).toMatch(/unique-local/);
    expect(ipBlocked("fe80::1")).toMatch(/link-local/);
    expect(ipBlocked("::ffff:127.0.0.1")).toMatch(/loopback/);
    expect(ipBlocked("2001:4860:4860::8888")).toBeNull();
  });
});

describe("hostLiteralBlocked", () => {
  it("blocks localhost, *.internal/.local, and bare private IP literals", () => {
    expect(hostLiteralBlocked("localhost")).not.toBeNull();
    expect(hostLiteralBlocked("metadata.google.internal")).not.toBeNull();
    expect(hostLiteralBlocked("db.svc.internal")).not.toBeNull();
    expect(hostLiteralBlocked("10.1.2.3")).toMatch(/private/);
    expect(hostLiteralBlocked("169.254.169.254")).toMatch(/link-local|metadata/);
  });

  it("allows a normal public hostname", () => {
    expect(hostLiteralBlocked("db.example.com")).toBeNull();
  });
});

describe("assertHostAllowed", () => {
  it("rejects a blocked literal", async () => {
    await expect(assertHostAllowed("169.254.169.254")).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a public name that resolves to a private IP (rebinding defence)", async () => {
    await expect(
      assertHostAllowed("evil.example.com", { resolve: async () => ["10.0.0.7"] }),
    ).rejects.toMatchObject({ code: "dbstudio.host_blocked" });
  });

  it("allows a public name that resolves to a public IP", async () => {
    await expect(
      assertHostAllowed("db.example.com", { resolve: async () => ["203.0.113.5"] }),
    ).resolves.toBeUndefined();
  });

  it("allowPrivate bypasses every check (operator opt-in)", async () => {
    await expect(assertHostAllowed("127.0.0.1", { allowPrivate: true })).resolves.toBeUndefined();
  });
});
