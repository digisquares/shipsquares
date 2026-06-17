import { describe, expect, it } from "vitest";

import { toRegistryCredentialView } from "./registry-credentials.service.js";

describe("registry credential view", () => {
  it("never exposes the sealed password", () => {
    const view = toRegistryCredentialView({
      id: "reg_1",
      organizationId: "org_1",
      registryUrl: "ghcr.io",
      username: "bot",
      passwordSecretRef: "SEALED",
      createdAt: new Date("2026-06-10T12:00:00Z"),
    });
    expect(view).toEqual({
      id: "reg_1",
      registryUrl: "ghcr.io",
      username: "bot",
      createdAt: "2026-06-10T12:00:00.000Z",
    });
    expect(JSON.stringify(view)).not.toContain("SEALED");
  });
});
