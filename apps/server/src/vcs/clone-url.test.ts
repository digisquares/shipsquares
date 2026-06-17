import { describe, expect, it } from "vitest";

import { cloneUrlWithToken, installationTokenUrl } from "./clone-url.js";

describe("clone-url helpers", () => {
  it("builds the installation access-token endpoint", () => {
    expect(installationTokenUrl("42")).toBe(
      "https://api.github.com/app/installations/42/access_tokens",
    );
  });

  it("injects a token as the x-access-token user", () => {
    expect(cloneUrlWithToken("https://github.com/acme/api", "ghs_abc123")).toBe(
      "https://x-access-token:ghs_abc123@github.com/acme/api",
    );
  });

  it("rejects a non-https repo url", () => {
    expect(() => cloneUrlWithToken("git@github.com:acme/api.git", "t")).toThrow(/https/);
  });
});
