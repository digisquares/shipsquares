import { describe, expect, it } from "vitest";

import { previewContainerName, previewRoutes } from "./orchestrator.js";

describe("previewContainerName", () => {
  it("is deterministic per app+pr and docker-name safe", () => {
    expect(previewContainerName("app_abc123", 7)).toBe("ss-preview-app_abc123-7");
    expect(previewContainerName("app_abc123", 7)).toBe(previewContainerName("app_abc123", 7));
  });
});

describe("previewRoutes", () => {
  it("running previews with a domain + port become Caddy routes (no HSTS — ephemeral hosts)", () => {
    const { apps, domains } = previewRoutes([
      { appId: "app_1", domain: "pr-7-web.preview.acme.dev", hostPort: "49213" },
    ]);
    expect(apps).toEqual([
      {
        appId: "app_1",
        hosts: ["pr-7-web.preview.acme.dev"],
        target: { upstream: "127.0.0.1:49213" },
        hsts: false,
        forceHttps: true,
      },
    ]);
    expect(domains).toEqual([{ fqdn: "pr-7-web.preview.acme.dev", managed: "auto" }]);
  });

  it("skips previews without a domain or a running port", () => {
    const { apps } = previewRoutes([
      { appId: "app_1", domain: null, hostPort: "1" },
      { appId: "app_1", domain: "x.dev" }, // not running yet
    ]);
    expect(apps).toEqual([]);
  });
});
