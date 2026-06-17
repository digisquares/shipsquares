import { describe, expect, it } from "vitest";

import { githubInstallUrl } from "./github-install.js";

describe("githubInstallUrl", () => {
  it("builds the install URL with an encoded state", () => {
    expect(githubInstallUrl("shipsquares", "abc.def")).toBe(
      "https://github.com/apps/shipsquares/installations/new?state=abc.def",
    );
  });

  it("url-encodes special characters in slug and state", () => {
    const url = githubInstallUrl("my app", "a/b+c");
    expect(url).toContain("apps/my%20app/");
    expect(url).toContain("state=a%2Fb%2Bc");
  });
});
