import { describe, expect, it, vi } from "vitest";

import {
  buildGithubAppManifest,
  exchangeManifestCode,
  manifestPostUrl,
  renderManifestForm,
} from "./github-manifest.js";

describe("buildGithubAppManifest", () => {
  it("points redirect at the control-plane base and requests deploy+PR scope", () => {
    const m = buildGithubAppManifest({
      name: "ShipSquares-acme",
      baseUrl: "https://cp.example.com/",
    });
    expect(m.name).toBe("ShipSquares-acme");
    expect(m.url).toBe("https://cp.example.com");
    expect(m.redirect_url).toBe("https://cp.example.com/vcs/github/app/manifest/callback");
    expect(m.callback_urls).toEqual(["https://cp.example.com/vcs/github/app/manifest/callback"]);
    expect(m.hook_attributes).toEqual({
      url: "https://cp.example.com/hooks/github/app",
      active: true,
    });
    expect(m.public).toBe(false);
    expect(m.default_permissions).toMatchObject({
      contents: "read",
      metadata: "read",
      pull_requests: "write",
    });
    expect(m.default_events).toEqual(["push", "pull_request"]);
  });
});

describe("renderManifestForm", () => {
  it("embeds the action + manifest JSON and escapes < to keep the script tag intact", () => {
    const m = buildGithubAppManifest({ name: "X", baseUrl: "https://cp.example.com" });
    const html = renderManifestForm("https://github.com/settings/apps/new?state=abc", m);
    expect(html).toContain('action="https://github.com/settings/apps/new?state=abc"');
    expect(html).toContain('name="manifest"');
    expect(html).toContain(
      '"redirect_url":"https://cp.example.com/vcs/github/app/manifest/callback"',
    );
    expect(html).not.toContain("</script></script>");
  });
});

describe("manifestPostUrl", () => {
  it("targets the personal apps/new by default and the org variant when given an org", () => {
    expect(manifestPostUrl()).toBe("https://github.com/settings/apps/new");
    expect(manifestPostUrl("acme-inc")).toBe(
      "https://github.com/organizations/acme-inc/settings/apps/new",
    );
  });
});

describe("exchangeManifestCode", () => {
  const body = {
    id: 123456,
    slug: "shipsquares-acme",
    name: "ShipSquares acme",
    html_url: "https://github.com/apps/shipsquares-acme",
    client_id: "Iv1.abc",
    client_secret: "secret-xyz",
    webhook_secret: "whsec-123",
    pem: "-----BEGIN RSA PRIVATE KEY-----\nMII...\n-----END RSA PRIVATE KEY-----\n",
  };

  it("POSTs to /app-manifests/{code}/conversions and maps the credentials", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.github.com/app-manifests/tmpcode/conversions");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify(body), { status: 201 });
    });
    const creds = await exchangeManifestCode("tmpcode", fetchImpl as unknown as typeof fetch);
    expect(creds).toEqual({
      appId: "123456",
      slug: "shipsquares-acme",
      name: "ShipSquares acme",
      htmlUrl: "https://github.com/apps/shipsquares-acme",
      clientId: "Iv1.abc",
      clientSecret: "secret-xyz",
      webhookSecret: "whsec-123",
      privateKey: body.pem,
    });
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 422 }));
    await expect(exchangeManifestCode("c", fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      /HTTP 422/,
    );
  });

  it("throws when the payload is missing load-bearing fields", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ id: 1, slug: "s" }), { status: 201 }),
    );
    await expect(exchangeManifestCode("c", fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      /missing required fields/,
    );
  });
});
