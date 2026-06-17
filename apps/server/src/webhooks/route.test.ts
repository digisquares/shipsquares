import { describe, expect, it } from "vitest";

import { filterRoutableApps, hasSkipKeyword, matchesWatchPaths, pollChanged } from "./route.js";

describe("hasSkipKeyword", () => {
  it("detects skip-ci keywords case-insensitively", () => {
    expect(hasSkipKeyword("fix: thing [skip ci]")).toBe(true);
    expect(hasSkipKeyword("WIP [CI SKIP]")).toBe(true);
    expect(hasSkipKeyword("normal commit")).toBe(false);
  });
});

describe("matchesWatchPaths", () => {
  it("deploys when there is no watchPaths filter", () => {
    expect(matchesWatchPaths(null, ["a"])).toBe(true);
    expect(matchesWatchPaths([], ["a"])).toBe(true);
  });

  it("does not match when no changed file matches a pattern (micromatch.some)", () => {
    // mirrors Dokploy shouldDeploy: empty/non-matching files → false
    expect(matchesWatchPaths(["src/**"], [])).toBe(false);
    expect(matchesWatchPaths(["docs/**"], ["src/app/index.ts"])).toBe(false);
    expect(matchesWatchPaths(["*.md"], ["docs/README.md"])).toBe(false);
  });

  it("globs ** across segments and * within a segment", () => {
    expect(matchesWatchPaths(["src/**"], ["src/app/index.ts"])).toBe(true);
    expect(matchesWatchPaths(["*.md"], ["README.md"])).toBe(true);
  });
});

describe("filterRoutableApps", () => {
  it("drops everything on [skip ci]", () => {
    const apps = [{ id: "a" }, { id: "b" }];
    expect(filterRoutableApps(apps, { changedPaths: ["x"], commitMessage: "[skip ci]" })).toEqual(
      [],
    );
  });

  it("keeps apps whose watchPaths match the changed files", () => {
    const apps = [
      { id: "web", watchPaths: ["apps/web/**"] },
      { id: "api", watchPaths: ["apps/api/**"] },
    ];
    const kept = filterRoutableApps(apps, { changedPaths: ["apps/web/src/x.ts"] });
    expect(kept.map((a) => a.id)).toEqual(["web"]);
  });
});

describe("pollChanged", () => {
  it("is true only when the remote tip advances", () => {
    expect(pollChanged("sha2", "sha1")).toBe(true);
    expect(pollChanged("sha1", "sha1")).toBe(false);
    expect(pollChanged("sha1", null)).toBe(true);
    expect(pollChanged("", "sha1")).toBe(false);
  });
});
