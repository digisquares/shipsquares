import { describe, expect, it, vi } from "vitest";

import { assertPublicUrl, assertPublicUrlResolved, isPrivateHost } from "./public-url.js";

describe("assertPublicUrl", () => {
  it("allows public http(s) endpoints", () => {
    expect(assertPublicUrl("https://hooks.slack.com/services/T/B/x").hostname).toBe(
      "hooks.slack.com",
    );
    expect(assertPublicUrl("http://8.8.8.8/hook").hostname).toBe("8.8.8.8");
  });

  it("rejects loopback/private/link-local literals (incl. the Caddy admin API)", () => {
    for (const url of [
      "http://127.0.0.1:2019/load",
      "http://localhost/x",
      "http://sub.localhost/x",
      "http://0.0.0.0/",
      "http://10.0.0.5/",
      "http://172.20.1.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]:8080/",
      "http://[fd00::1]/",
      "http://[fe80::1]/",
      "http://[::ffff:127.0.0.1]/",
    ]) {
      expect(() => assertPublicUrl(url), url).toThrow();
    }
  });

  it("respects the 172.16/12 boundary", () => {
    expect(isPrivateHost("172.15.1.1")).toBe(false);
    expect(isPrivateHost("172.16.0.1")).toBe(true);
    expect(isPrivateHost("172.31.255.255")).toBe(true);
    expect(isPrivateHost("172.32.0.1")).toBe(false);
  });

  it("rejects non-http schemes and garbage", () => {
    expect(() => assertPublicUrl("ftp://example.com/x")).toThrow();
    expect(() => assertPublicUrl("file:///etc/passwd")).toThrow();
    expect(() => assertPublicUrl("not a url")).toThrow();
  });
});

describe("assertPublicUrlResolved (DNS-rebinding defence, S4)", () => {
  it("rejects a public-looking host that RESOLVES to a private/loopback address", async () => {
    const resolve = vi.fn().mockResolvedValue(["127.0.0.1"]);
    await expect(assertPublicUrlResolved("https://evil.example.com/hook", resolve)).rejects.toThrow(
      /private or loopback/i,
    );
    expect(resolve).toHaveBeenCalledWith("evil.example.com");
  });

  it("rejects when ANY resolved address is private (mixed A records)", async () => {
    const resolve = vi.fn().mockResolvedValue(["93.184.216.34", "169.254.169.254"]);
    await expect(assertPublicUrlResolved("https://evil.example.com/", resolve)).rejects.toThrow(
      /169\.254\.169\.254/,
    );
  });

  it("allows a host that resolves only to public addresses", async () => {
    const resolve = vi.fn().mockResolvedValue(["93.184.216.34"]);
    const url = await assertPublicUrlResolved("https://hooks.slack.com/x", resolve);
    expect(url.hostname).toBe("hooks.slack.com");
  });

  it("still rejects literal private hosts before any lookup", async () => {
    const resolve = vi.fn();
    await expect(assertPublicUrlResolved("http://127.0.0.1:2019/load", resolve)).rejects.toThrow();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("skips the lookup for an allowed IP literal", async () => {
    const resolve = vi.fn();
    const url = await assertPublicUrlResolved("http://8.8.8.8/hook", resolve);
    expect(url.hostname).toBe("8.8.8.8");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("defers (allows) when the host can't be resolved right now", async () => {
    const resolve = vi.fn().mockRejectedValue(new Error("ENOTFOUND"));
    const url = await assertPublicUrlResolved("https://maybe-temporary.example.com/", resolve);
    expect(url.hostname).toBe("maybe-temporary.example.com");
  });
});
