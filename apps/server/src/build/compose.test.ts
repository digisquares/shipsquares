import { describe, expect, it } from "vitest";

import { buildComposeArgs } from "./compose.js";

describe("buildComposeArgs", () => {
  it("builds a `docker compose up` command with project isolation", () => {
    expect(buildComposeArgs({ appName: "stack1", composePath: "docker-compose.yml" })).toEqual([
      "compose",
      "-p",
      "stack1",
      "-f",
      "docker-compose.yml",
      "up",
      "-d",
      "--build",
      "--remove-orphans",
    ]);
  });

  it("builds a swarm `stack deploy` command for the stack type", () => {
    expect(
      buildComposeArgs({ appName: "stack1", composePath: "compose.yml", type: "stack" }),
    ).toEqual([
      "stack",
      "deploy",
      "-c",
      "compose.yml",
      "stack1",
      "--prune",
      "--with-registry-auth",
    ]);
  });
});
