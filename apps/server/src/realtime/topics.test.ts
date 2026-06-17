import { describe, expect, it } from "vitest";

import { appTopic, deploymentTopic, orgTopic, parseTopic } from "./topics.js";

describe("topics", () => {
  it("builds and parses round-trip", () => {
    expect(deploymentTopic("dpl_1")).toBe("deployment:dpl_1");
    expect(parseTopic(deploymentTopic("dpl_1"))).toEqual({ kind: "deployment", id: "dpl_1" });
    expect(parseTopic(appTopic("app_1"))).toEqual({ kind: "app", id: "app_1" });
    expect(parseTopic(orgTopic("org_1"))).toEqual({ kind: "org", id: "org_1" });
  });

  it("rejects malformed or unknown topics", () => {
    expect(parseTopic("nope")).toBeNull();
    expect(parseTopic("deployment:")).toBeNull();
    expect(parseTopic("secret:x")).toBeNull();
  });

  it("preserves ids that contain a colon", () => {
    expect(parseTopic("app:a:b")).toEqual({ kind: "app", id: "a:b" });
  });
});
