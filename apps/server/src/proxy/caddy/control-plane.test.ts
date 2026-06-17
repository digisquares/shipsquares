import type { Env } from "@ss/shared";
import { describe, expect, it } from "vitest";

import { controlPlaneDesired } from "./control-plane.js";

const env: Env = {
  NODE_ENV: "test",
  PORT: 3000,
  DATABASE_URL: "postgres://localhost:5432/x",
  AUTH_SECRET: "x".repeat(32),
  AUTH_URL: "https://ship.example.com",
  CADDY_ADMIN_URL: "http://localhost:2019",
  PROXY_DRIVER: "caddy",
  SS_BUILDS_DIR: "/var/lib/shipsquares/builds",
  SS_APP_PORT: 8080,
  SS_HEALTH_ATTEMPTS: 30,
  LOG_LEVEL: "info",
  ALLOW_SIGNUP: true,
  SS_VERSION: "dev",
  SS_RELEASE_CHANNEL: "stable",
  SS_UPDATE_MANIFEST_BASE: "https://get.shipsquares.com/channels",
  SS_UPDATE_CHECK: true,
  SS_STATE_DIR: "/var/lib/shipsquares",
};

describe("controlPlaneDesired", () => {
  it("derives the edge host from AUTH_URL and proxies to the local port", () => {
    const desired = controlPlaneDesired(env);
    expect(desired.apps[0]?.hosts).toEqual(["ship.example.com"]);
    expect(desired.apps[0]?.target.upstream).toBe("127.0.0.1:3000");
    expect(desired.domains[0]).toEqual({ fqdn: "ship.example.com", managed: "auto" });
  });

  it("uses the AUTH_URL host even on a non-default port", () => {
    const desired = controlPlaneDesired({ ...env, AUTH_URL: "http://localhost:3000", PORT: 3000 });
    expect(desired.apps[0]?.hosts).toEqual(["localhost"]);
  });
});
