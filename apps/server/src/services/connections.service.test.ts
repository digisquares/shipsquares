import { describe, expect, it } from "vitest";

import { toConnection, toView } from "./connections.service.js";

// A vcs_connections row (drizzle $inferSelect shape).
const row = {
  id: "vcs_1",
  organizationId: "org_1",
  provider: "github" as const,
  kind: "github_app" as const,
  accountLogin: "acme",
  installationId: "42",
  githubAppId: "1001",
  tokenSecretRef: "secret_pk",
  appRegistrationId: null,
  tokenExpiresAt: null,
  createdAt: new Date("2026-06-09T12:00:00Z"),
};

describe("connections.service mappers", () => {
  it("toView never exposes the token secret ref", () => {
    const view = toView(row);
    expect(view).not.toHaveProperty("tokenSecretRef");
    expect(view).not.toHaveProperty("organizationId");
    expect(view).toEqual({
      id: "vcs_1",
      provider: "github",
      kind: "github_app",
      accountLogin: "acme",
      installationId: "42",
      githubAppId: "1001",
      createdAt: "2026-06-09T12:00:00.000Z",
    });
  });

  it("toConnection includes the secret ref for the provider layer", () => {
    const conn = toConnection(row);
    expect(conn.tokenSecretRef).toBe("secret_pk");
    expect(conn.organizationId).toBe("org_1");
  });
});
