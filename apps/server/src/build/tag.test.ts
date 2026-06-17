import { describe, expect, it } from "vitest";

import { imageTag, latestTag, shortCommit } from "./tag.js";

describe("image tagging", () => {
  it("shortens a commit to 7 chars", () => {
    expect(shortCommit("9f2c1abdeadbeef00")).toBe("9f2c1ab");
  });

  it("builds <app>:<commitShort> and <app>:latest", () => {
    expect(imageTag("myapp", "9f2c1abdeadbeef00")).toBe("myapp:9f2c1ab");
    expect(latestTag("myapp")).toBe("myapp:latest");
  });
});
