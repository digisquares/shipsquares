import { describe, expect, it } from "vitest";

import { connectionLabel, filterRepos, kindLabel, providerName, type RepoRef } from "./connections";

const repo = (fullName: string): RepoRef => {
  const [owner, name] = fullName.split("/");
  return {
    owner: owner!,
    name: name!,
    fullName,
    defaultBranch: "main",
    private: false,
    cloneUrl: `https://github.com/${fullName}.git`,
  };
};

describe("connection labels", () => {
  it("names providers and kinds", () => {
    expect(providerName("github")).toBe("GitHub");
    expect(providerName("gitlab")).toBe("GitLab");
    expect(kindLabel("github_app")).toBe("App");
    expect(kindLabel("oauth")).toBe("OAuth");
    expect(kindLabel("manual")).toBe("Manual");
  });

  it("composes a connection label", () => {
    expect(connectionLabel({ provider: "github", kind: "github_app", accountLogin: "acme" })).toBe(
      "GitHub App · acme",
    );
    expect(connectionLabel({ provider: "gitlab", kind: "oauth", accountLogin: "dev" })).toBe(
      "GitLab OAuth · dev",
    );
  });
});

describe("filterRepos", () => {
  const repos = [repo("acme/web"), repo("acme/api"), repo("other/site")];
  it("returns all for an empty query", () => {
    expect(filterRepos(repos, "  ").map((r) => r.fullName)).toEqual([
      "acme/web",
      "acme/api",
      "other/site",
    ]);
  });
  it("filters case-insensitively by full name", () => {
    expect(filterRepos(repos, "ACME").map((r) => r.fullName)).toEqual(["acme/web", "acme/api"]);
    expect(filterRepos(repos, "site").map((r) => r.fullName)).toEqual(["other/site"]);
  });
});
