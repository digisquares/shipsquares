import { describe, expect, it } from "vitest";

import { ROLE_MATRIX } from "../rbac/roles.js";

import {
  DEFAULT_DEVICE_REDIRECT,
  deviceLoginScopes,
  deviceTokenName,
  isAllowedDeviceRedirect,
} from "./login-flow.js";

describe("isAllowedDeviceRedirect", () => {
  it("accepts the app's own scheme", () => {
    expect(isAllowedDeviceRedirect("ss://login")).toBe(true);
    expect(isAllowedDeviceRedirect(DEFAULT_DEVICE_REDIRECT)).toBe(true);
  });

  it("rejects http(s) origins, other hosts, and junk", () => {
    expect(isAllowedDeviceRedirect("https://login")).toBe(false);
    expect(isAllowedDeviceRedirect("http://login")).toBe(false);
    expect(isAllowedDeviceRedirect("ss://login.evil.com")).toBe(false);
    expect(isAllowedDeviceRedirect("ss://evil")).toBe(false);
    expect(isAllowedDeviceRedirect("javascript:alert(1)")).toBe(false);
    expect(isAllowedDeviceRedirect("")).toBe(false);
    expect(isAllowedDeviceRedirect("not a url")).toBe(false);
  });
});

describe("deviceLoginScopes — never exceeds the user's role, capped at deployer", () => {
  it("a viewer's device stays read-only and never reads secrets", () => {
    const scopes = deviceLoginScopes("viewer");
    expect(scopes.length).toBeGreaterThan(0);
    expect(scopes.every((p) => p.endsWith(":read"))).toBe(true);
    expect(scopes).not.toContain("secret:read"); // viewer excludes it
    expect(scopes).not.toContain("app:write");
  });

  it("a deployer's device gets exactly the deployer set", () => {
    const scopes = new Set(deviceLoginScopes("deployer"));
    expect(scopes).toEqual(ROLE_MATRIX.deployer);
  });

  it("an owner's device is capped to the deployer set (no org administration)", () => {
    const scopes = new Set(deviceLoginScopes("owner"));
    expect(scopes).toEqual(ROLE_MATRIX.deployer);
    expect(scopes.has("app:write")).toBe(true);
    expect(scopes.has("member:write")).toBe(false);
    expect(scopes.has("org:delete")).toBe(false);
  });
});

describe("deviceTokenName", () => {
  it("defaults, trims, and truncates", () => {
    expect(deviceTokenName()).toBe("Mobile (Login Flow)");
    expect(deviceTokenName("  iPhone  ")).toBe("iPhone");
    expect(deviceTokenName("x".repeat(200)).length).toBe(120);
  });
});
