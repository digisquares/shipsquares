import { describe, expect, it } from "vitest";

import { appRoutesFromDomains } from "./converge.js";

describe("appRoutesFromDomains", () => {
  it("builds a reverse-proxy route for a deployed domain", () => {
    const { apps, domains } = appRoutesFromDomains([
      { appId: "app_1", fqdn: "api.example.com", https: true, hostPort: "32768" },
    ]);
    expect(apps).toEqual([
      {
        appId: "app_1",
        hosts: ["api.example.com"],
        target: { upstream: "127.0.0.1:32768" },
        hsts: true,
        forceHttps: true,
      },
    ]);
    expect(domains).toEqual([{ fqdn: "api.example.com", managed: "auto" }]);
  });

  it("skips domains whose app has no running container yet", () => {
    const { apps, domains } = appRoutesFromDomains([
      { appId: "app_1", fqdn: "pending.example.com", https: true },
    ]);
    expect(apps).toEqual([]);
    expect(domains).toEqual([]);
  });
});
