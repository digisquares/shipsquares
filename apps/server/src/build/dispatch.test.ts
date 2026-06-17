import { describe, expect, it } from "vitest";

import { detectBuilder, resolveComposeFile, selectBuilder, type WorkDir } from "./dispatch.js";

function workDir(...files: string[]): WorkDir {
  const set = new Set(files);
  return { has: (f) => set.has(f) };
}

describe("selectBuilder", () => {
  it("short-circuits to image for an image source", () => {
    expect(selectBuilder({ sourceType: "image", buildStrategy: "dockerfile" })).toBe("image");
  });

  it("uses the app's explicit strategy", () => {
    expect(selectBuilder({ buildStrategy: "dockerfile" })).toBe("dockerfile");
    expect(selectBuilder({ buildStrategy: "nixpacks" })).toBe("nixpacks");
  });

  it("defaults to compose when no strategy is set", () => {
    expect(selectBuilder({})).toBe("compose");
  });
});

describe("detectBuilder", () => {
  it("prefers a compose file", () => {
    expect(detectBuilder(workDir("compose.yaml", "Dockerfile"))).toBe("compose");
    expect(detectBuilder(workDir("docker-compose.yml"))).toBe("compose");
  });

  it("falls back to a Dockerfile", () => {
    expect(detectBuilder(workDir("Dockerfile"))).toBe("dockerfile");
  });

  it("falls back to nixpacks only when enabled", () => {
    expect(detectBuilder(workDir("package.json"), true)).toBe("nixpacks");
  });

  it("throws when there is no buildable source", () => {
    expect(() => detectBuilder(workDir("README.md"))).toThrow(/no buildable source/);
  });
});

describe("resolveComposeFile", () => {
  it("honors an explicit composePath when the file exists, null when missing", () => {
    const wd = workDir("deploy/stack.yml");
    expect(resolveComposeFile({ composePath: "deploy/stack.yml" }, wd)).toBe("deploy/stack.yml");
    expect(resolveComposeFile({ composePath: "missing.yml" }, wd)).toBeNull();
  });

  it("falls back through the standard compose filenames", () => {
    expect(resolveComposeFile({}, workDir("compose.yaml"))).toBe("compose.yaml");
    expect(resolveComposeFile({}, workDir("docker-compose.yml", "Dockerfile"))).toBe(
      "docker-compose.yml",
    );
    expect(resolveComposeFile({}, workDir("Dockerfile"))).toBeNull();
  });

  it("prefixes the build rootDirectory", () => {
    const wd = workDir("backend/docker-compose.yml");
    expect(resolveComposeFile({ rootDirectory: "backend" }, wd)).toBe("backend/docker-compose.yml");
    expect(
      resolveComposeFile({ rootDirectory: "backend", composePath: "docker-compose.yml" }, wd),
    ).toBe("backend/docker-compose.yml");
  });

  it("treats the default composePath as a fallback, not an explicit choice", () => {
    // The schema defaults compose_path to "docker-compose.yml" — a repo using
    // compose.yaml must still resolve.
    expect(resolveComposeFile({ composePath: "docker-compose.yml" }, workDir("compose.yaml"))).toBe(
      "compose.yaml",
    );
  });
});
