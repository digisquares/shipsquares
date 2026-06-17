import { describe, expect, it } from "vitest";

import { preDeployCommand, postDeployCommand } from "./hooks.js";

describe("deploy hooks composition", () => {
  it("pre-deploy runs in a throwaway container of the BUILT image", () => {
    expect(preDeployCommand("myapp:9f2c1ab", "npm run migrate")).toBe(
      "docker run --rm 'myapp:9f2c1ab' sh -c 'npm run migrate'",
    );
  });

  it("post-deploy execs inside the RUNNING container", () => {
    expect(postDeployCommand("ss-app_1-17", "npm run warm-cache")).toBe(
      "docker exec 'ss-app_1-17' sh -c 'npm run warm-cache'",
    );
  });

  it("quotes injection attempts (exact escaped form)", () => {
    expect(preDeployCommand("t", "x'; rm -rf /; '")).toBe(
      "docker run --rm 't' sh -c 'x'\\''; rm -rf /; '\\'''",
    );
  });
});
