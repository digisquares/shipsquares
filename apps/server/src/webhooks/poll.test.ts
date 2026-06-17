import { describe, expect, it } from "vitest";

import { parseLsRemoteHead, pollDecision } from "./poll.js";

describe("parseLsRemoteHead", () => {
  it("takes the sha of the branch ref, preferring it over HEAD", () => {
    const out =
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2\tHEAD\n" +
      "ffeeddccbbaaffeeddccbbaaffeeddccbbaaffee\trefs/heads/main";
    expect(parseLsRemoteHead(out, "main")).toBe("ffeeddccbbaaffeeddccbbaaffeeddccbbaaffee");
  });

  it("falls back to HEAD when the branch ref is absent", () => {
    expect(parseLsRemoteHead("a1b2c3d4\tHEAD", "release")).toBe("a1b2c3d4");
  });

  it("returns null for empty/garbled output", () => {
    expect(parseLsRemoteHead("", "main")).toBeNull();
    expect(parseLsRemoteHead("fatal: repository not found", "main")).toBeNull();
  });
});

describe("pollDecision", () => {
  it("deploys when the remote head moved past the last deployed commit", () => {
    expect(pollDecision({ remoteHead: "bbb", lastDeployedCommit: "aaa" })).toBe("deploy");
  });

  it("skips when nothing changed", () => {
    expect(pollDecision({ remoteHead: "aaa", lastDeployedCommit: "aaa" })).toBe("skip");
  });

  it("deploys a never-deployed app on its first successful poll", () => {
    expect(pollDecision({ remoteHead: "aaa", lastDeployedCommit: null })).toBe("deploy");
  });

  it("skips when the remote can't be read (never deploy blind)", () => {
    expect(pollDecision({ remoteHead: null, lastDeployedCommit: "aaa" })).toBe("skip");
  });
});
