import { describe, expect, it } from "vitest";

import { type CaddyHandler, generateCaddyConfig } from "./config.js";

const app = {
  appId: "42",
  hosts: ["app.acme.com", "acme.com"],
  target: { upstream: "app_42:3000" },
  hsts: true,
};

function routesOf(cfg: ReturnType<typeof generateCaddyConfig>) {
  return cfg.apps.http.servers.edge.routes;
}
function handler(handle: CaddyHandler[], name: string): CaddyHandler | undefined {
  return handle.find((h) => h.handler === name);
}

describe("generateCaddyConfig", () => {
  it("emits an app route with @id, host match, reverse_proxy, terminal", () => {
    const cfg = generateCaddyConfig({
      apps: [app],
      domains: [{ fqdn: "app.acme.com", managed: "auto" }],
    });
    const route = routesOf(cfg)[0];
    expect(route?.["@id"]).toBe("app_42");
    expect(route?.match).toEqual([{ host: ["app.acme.com", "acme.com"] }]);
    expect(route?.terminal).toBe(true);
    expect(handler(route?.handle ?? [], "reverse_proxy")?.upstreams).toEqual([
      { dial: "app_42:3000" },
    ]);
  });

  it("adds the HSTS headers handler only when hsts is set", () => {
    const withHsts = routesOf(generateCaddyConfig({ apps: [app], domains: [] }))[0];
    expect(handler(withHsts?.handle ?? [], "headers")).toBeDefined();
    const noHsts = routesOf(
      generateCaddyConfig({ apps: [{ ...app, hsts: false }], domains: [] }),
    )[0];
    expect(handler(noHsts?.handle ?? [], "headers")).toBeUndefined();
  });

  it("maps auto vs on-demand domains to tls policies", () => {
    const cfg = generateCaddyConfig({
      apps: [app],
      domains: [
        { fqdn: "app.acme.com", managed: "auto" },
        { fqdn: "custom.tenant.com", managed: "on-demand" },
      ],
    });
    expect(cfg.apps.tls.automation.policies).toEqual([
      { subjects: ["app.acme.com"] },
      { subjects: ["custom.tenant.com"], on_demand: true },
    ]);
  });

  it("gates on-demand policies behind the ask endpoint (http permission module)", () => {
    const cfg = generateCaddyConfig({
      apps: [app],
      domains: [
        { fqdn: "app.acme.com", managed: "auto" },
        { fqdn: "custom.tenant.com", managed: "on-demand" },
      ],
      askEndpoint: "http://127.0.0.1:3000/internal/tls/ask",
    });
    expect(cfg.apps.tls.automation.on_demand).toEqual({
      permission: { module: "http", endpoint: "http://127.0.0.1:3000/internal/tls/ask" },
    });
  });

  it("omits the on_demand block when no on-demand domains exist", () => {
    const cfg = generateCaddyConfig({
      apps: [app],
      domains: [{ fqdn: "app.acme.com", managed: "auto" }],
      askEndpoint: "http://127.0.0.1:3000/internal/tls/ask",
    });
    expect(cfg.apps.tls.automation.on_demand).toBeUndefined();
  });

  it("orders redirect routes ahead of app routes with the right status", () => {
    const cfg = generateCaddyConfig({
      apps: [app],
      domains: [],
      redirects: [
        {
          id: "r1",
          fromHosts: ["www.acme.com"],
          toTarget: "https://acme.com{uri}",
          permanent: true,
        },
      ],
    });
    const routes = routesOf(cfg);
    expect(routes[0]?.["@id"]).toBe("redirect_r1");
    expect(handler(routes[0]?.handle ?? [], "static_response")?.status_code).toBe(308);
    expect(routes[1]?.["@id"]).toBe("app_42");
  });

  it("inserts http_basic before reverse_proxy without leaking the plaintext", () => {
    const cfg = generateCaddyConfig({
      apps: [app],
      domains: [],
      basicAuth: { "42": { username: "ops", bcryptHash: "$2b$10$hashhashhash" } },
    });
    const route = routesOf(cfg)[0];
    const handle = route?.handle ?? [];
    const authIdx = handle.findIndex((h) => h.handler === "authentication");
    const proxyIdx = handle.findIndex((h) => h.handler === "reverse_proxy");
    expect(authIdx).toBeGreaterThanOrEqual(0);
    expect(authIdx).toBeLessThan(proxyIdx);
    expect(JSON.stringify(route)).toContain("$2b$10$hashhashhash");
    expect(JSON.stringify(route)).not.toContain("plaintext");
  });

  it("loads a custom cert via load_pem and omits its domain from automation", () => {
    const cfg = generateCaddyConfig({
      apps: [app],
      domains: [{ fqdn: "secure.acme.com", managed: "auto" }],
      customCerts: [{ domain: "secure.acme.com", certPem: "CERT", keyPem: "KEY" }],
    });
    expect(cfg.apps.tls.certificates?.load_pem).toEqual([{ certificate: "CERT", key: "KEY" }]);
    expect(cfg.apps.tls.automation.policies).toEqual([]); // domain omitted (no ACME)
  });
});
