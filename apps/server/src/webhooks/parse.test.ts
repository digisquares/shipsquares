import { describe, expect, it } from "vitest";

import { parseBitbucket, parseGithub, parseGitlab } from "./parse.js";

describe("provider payload parsing → VcsEvent", () => {
  it("parses a GitHub push payload", () => {
    const ev = parseGithub(
      {
        ref: "refs/heads/main",
        after: "9f2c1abdeadbeef",
        repository: { name: "my-api", owner: { login: "acme" } },
        head_commit: { message: "fix: thing" },
        commits: [{ modified: ["src/a.ts"], added: ["src/b.ts"], removed: [] }],
      },
      "del_1",
    );
    expect(ev).toMatchObject({
      provider: "github",
      repo: "my-api",
      owner: "acme",
      branch: "main",
      tag: null,
      commit: "9f2c1abdeadbeef",
      commitMessage: "fix: thing",
      deliveryId: "del_1",
    });
    expect(ev.changedPaths.sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("parses a GitHub tag push (branch null, tag set)", () => {
    const ev = parseGithub(
      { ref: "refs/tags/v1.2.0", after: "abc", repository: { name: "r", owner: { login: "o" } } },
      "del_2",
    );
    expect(ev.branch).toBeNull();
    expect(ev.tag).toBe("v1.2.0");
  });

  it("parses a GitLab push payload (owner/repo from path_with_namespace)", () => {
    const ev = parseGitlab(
      {
        ref: "refs/heads/dev",
        checkout_sha: "deadbeef",
        project: { path_with_namespace: "group/sub/my-api", name: "my-api" },
        commits: [{ message: "chore", modified: ["a"] }],
      },
      "del_3",
    );
    expect(ev).toMatchObject({
      owner: "group/sub",
      repo: "my-api",
      branch: "dev",
      commit: "deadbeef",
    });
  });

  it("parses a Bitbucket repo:push payload", () => {
    const ev = parseBitbucket(
      {
        repository: { full_name: "acme/my-api", name: "my-api" },
        push: {
          changes: [
            { new: { type: "branch", name: "main", target: { hash: "cab1", message: "m" } } },
          ],
        },
      },
      "del_4",
    );
    expect(ev).toMatchObject({ owner: "acme", repo: "my-api", branch: "main", commit: "cab1" });
  });
});
