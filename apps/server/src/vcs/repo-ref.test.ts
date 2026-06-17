import { describe, expect, it } from "vitest";

import { type GithubRepo, repoRefFromUrl, safeRepoRefFromUrl, toRepoRef } from "./repo-ref.js";

describe("toRepoRef", () => {
  it("maps a GitHub repo object to a RepoRef", () => {
    const gh: GithubRepo = {
      name: "web",
      full_name: "acme/web",
      owner: { login: "acme" },
      default_branch: "trunk",
      private: true,
      clone_url: "https://github.com/acme/web.git",
    };
    expect(toRepoRef(gh)).toEqual({
      owner: "acme",
      name: "web",
      fullName: "acme/web",
      defaultBranch: "trunk",
      private: true,
      cloneUrl: "https://github.com/acme/web.git",
    });
  });

  it("defaults branch to main and private to false when absent", () => {
    const ref = toRepoRef({
      name: "x",
      full_name: "a/x",
      owner: { login: "a" },
      clone_url: "https://github.com/a/x.git",
    });
    expect(ref.defaultBranch).toBe("main");
    expect(ref.private).toBe(false);
  });
});

describe("repoRefFromUrl", () => {
  it("parses owner/name from a github https url", () => {
    expect(repoRefFromUrl("https://github.com/acme/web.git", "trunk")).toEqual({
      owner: "acme",
      name: "web",
      fullName: "acme/web",
      defaultBranch: "trunk",
      private: true,
      cloneUrl: "https://github.com/acme/web.git",
    });
  });
  it("handles a missing .git and trailing slash", () => {
    const r = repoRefFromUrl("https://github.com/acme/web/", "main");
    expect(r.fullName).toBe("acme/web");
  });
  it("keeps gitlab group/subgroup as the owner", () => {
    const r = repoRefFromUrl("https://gitlab.com/group/sub/repo.git", "main");
    expect(r.owner).toBe("group/sub");
    expect(r.name).toBe("repo");
    expect(r.fullName).toBe("group/sub/repo");
  });
});

describe("safeRepoRefFromUrl", () => {
  it("returns the ref for parseable https urls", () => {
    expect(safeRepoRefFromUrl("https://github.com/acme/web.git", "main")?.fullName).toBe(
      "acme/web",
    );
  });

  it("returns null for scp-style ssh urls instead of throwing (deploys fall back)", () => {
    expect(safeRepoRefFromUrl("git@github.com:acme/web.git", "main")).toBeNull();
    expect(safeRepoRefFromUrl("not a url at all", "main")).toBeNull();
  });
});
