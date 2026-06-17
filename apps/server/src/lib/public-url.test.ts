import { describe, expect, it } from "vitest";

import { assertPublicUrl, isPrivateHost } from "./public-url.js";

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
