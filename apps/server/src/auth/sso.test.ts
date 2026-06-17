import { describe, expect, it } from "vitest";

import { ssoProviders } from "./sso.js";

describe("ssoProviders", () => {
  it("includes a provider only when both id and secret are present", () => {
    const r = ssoProviders({
      SSO_GITHUB_CLIENT_ID: "gh-id",
      SSO_GITHUB_CLIENT_SECRET: "gh-secret",
      SSO_GOOGLE_CLIENT_ID: "goog-id",
      SSO_GOOGLE_CLIENT_SECRET: undefined,
    });
    expect(r.enabled).toEqual(["github"]);
    expect(r.providers.github).toEqual({ clientId: "gh-id", clientSecret: "gh-secret" });
    expect(r.providers.google).toBeUndefined();
  });

  it("returns nothing when no SSO env is set (feature stays off)", () => {
    const r = ssoProviders({});
    expect(r.enabled).toEqual([]);
    expect(Object.keys(r.providers)).toEqual([]);
  });

  it("enables both providers when fully configured, in a stable order", () => {
    const r = ssoProviders({
      SSO_GOOGLE_CLIENT_ID: "g",
      SSO_GOOGLE_CLIENT_SECRET: "gs",
      SSO_GITHUB_CLIENT_ID: "h",
      SSO_GITHUB_CLIENT_SECRET: "hs",
    });
    expect(r.enabled).toEqual(["github", "google"]);
  });
});
