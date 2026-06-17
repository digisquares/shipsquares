import { describe, expect, it } from "vitest";

import { providerFor, type ProviderDeps } from "./index.js";

const deps: ProviderDeps = {
  octokitFor: async () => ({
    auth: async () => ({ token: "t", expiresAt: "2099-01-01T00:00:00Z" }),
    paginate: async () => [],
    rest: {
      apps: { listReposAccessibleToInstallation: {} },
      repos: {
        listBranches: {},
        createWebhook: async () => ({ data: { id: 1 } }),
        deleteWebhook: async () => ({}),
      },
    },
  }),
  oauthOctokitForToken: () => ({
    paginate: async () => [],
    rest: {
      repos: {
        listForAuthenticatedUser: {},
        createWebhook: async () => ({ data: { id: 1 } }),
        deleteWebhook: async () => ({}),
      },
    },
  }),
  oauthRefresh: async (_conn, _refreshToken) => ({ accessToken: "x" }),
  oauthPersist: async () => {},
  readSecret: async () => "",
};

describe("providerFor", () => {
  it("returns the github_app provider", () => {
    expect(providerFor("github_app", deps).kind).toBe("github_app");
  });

  it("returns the oauth provider", () => {
    expect(providerFor("oauth", deps).kind).toBe("oauth");
  });

  it("returns the manual provider", () => {
    expect(providerFor("manual", deps).kind).toBe("manual");
  });
});
