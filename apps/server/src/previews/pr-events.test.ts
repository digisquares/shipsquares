import { describe, expect, it } from "vitest";

import { parsePullRequestEvent, previewActionFor } from "./pr-events.js";

// Shaped like GitHub's pull_request webhook payload.
const payload = (over: Record<string, unknown> = {}) => ({
  action: "opened",
  number: 7,
  pull_request: {
    head: { ref: "feat/x", sha: "abc123", repo: { full_name: "acme/web" } },
    base: { repo: { full_name: "acme/web" } },
    title: "Add x",
    labels: [{ name: "preview" }],
    author_association: "MEMBER",
    ...((over.pull_request as object) ?? {}),
  },
  ...over,
});

describe("parsePullRequestEvent", () => {
  it("extracts the fields previews need", () => {
    const e = parsePullRequestEvent(payload());
    expect(e).toEqual({
      action: "opened",
      prNumber: 7,
      headRef: "feat/x",
      headSha: "abc123",
      isFork: false,
      title: "Add x",
      labels: ["preview"],
      authorAssociation: "MEMBER",
    });
  });

  it("flags fork PRs (head repo differs from base)", () => {
    const e = parsePullRequestEvent(
      payload({
        pull_request: {
          head: { ref: "f", sha: "s", repo: { full_name: "evil/web" } },
          base: { repo: { full_name: "acme/web" } },
          title: "t",
          labels: [],
          author_association: "NONE",
        },
      }),
    );
    expect(e?.isFork).toBe(true);
  });

  it("returns null for non-PR shapes", () => {
    expect(parsePullRequestEvent({ ref: "refs/heads/main" })).toBeNull();
  });
});

describe("previewActionFor", () => {
  const settings = { enabled: true, requireLabel: null, trustedOnly: true, limitReached: false };
  const e = parsePullRequestEvent(payload())!;

  it("opened/synchronize/reopened deploy; closed tears down", () => {
    expect(previewActionFor(e, settings).action).toBe("deploy");
    expect(previewActionFor({ ...e, action: "synchronize" }, settings).action).toBe("deploy");
    expect(previewActionFor({ ...e, action: "closed" }, settings).action).toBe("teardown");
  });

  it("ignores when previews are disabled or the action is irrelevant", () => {
    expect(previewActionFor(e, { ...settings, enabled: false })).toEqual({
      action: "ignore",
      reason: "previews disabled",
    });
    expect(previewActionFor({ ...e, action: "labeled" }, settings).action).toBe("deploy");
    expect(previewActionFor({ ...e, action: "assigned" }, settings).action).toBe("ignore");
  });

  it("fork PRs from untrusted authors are ignored (dokploy's collaborator gate)", () => {
    const fork = { ...e, isFork: true, authorAssociation: "NONE" };
    expect(previewActionFor(fork, settings)).toEqual({
      action: "ignore",
      reason: "untrusted fork PR",
    });
    const trustedFork = { ...e, isFork: true, authorAssociation: "MEMBER" };
    expect(previewActionFor(trustedFork, settings).action).toBe("deploy");
  });

  it("honors a required label and [skip preview] in the title", () => {
    const labelGate = { ...settings, requireLabel: "preview" };
    expect(previewActionFor(e, labelGate).action).toBe("deploy"); // has the label
    expect(previewActionFor({ ...e, labels: [] }, labelGate)).toEqual({
      action: "ignore",
      reason: 'missing required label "preview"',
    });
    expect(previewActionFor({ ...e, title: "wip [skip preview]" }, settings)).toEqual({
      action: "ignore",
      reason: "skip marker in title",
    });
  });

  it("teardown always wins over gates; limit blocks new deploys only", () => {
    const closedFork = { ...e, action: "closed", isFork: true, authorAssociation: "NONE" };
    expect(previewActionFor(closedFork, settings).action).toBe("teardown");
    expect(previewActionFor(e, { ...settings, limitReached: true })).toEqual({
      action: "ignore",
      reason: "preview limit reached",
    });
  });
});
