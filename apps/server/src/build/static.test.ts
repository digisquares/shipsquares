import { describe, expect, it } from "vitest";

import { safePublishDir, staticDockerfile } from "./static.js";

describe("safePublishDir", () => {
  it("normalizes a relative dir and defaults to the context root", () => {
    expect(safePublishDir(undefined)).toBe(".");
    expect(safePublishDir("dist")).toBe("dist");
    expect(safePublishDir("./build/")).toBe("build");
    expect(safePublishDir("public/site")).toBe("public/site");
  });

  it("rejects path traversal and absolute paths (build-context escape)", () => {
    expect(() => safePublishDir("../etc")).toThrow(/outside/);
    expect(() => safePublishDir("/etc/passwd")).toThrow(/absolute/);
    expect(() => safePublishDir("dist/../../x")).toThrow(/outside/);
  });
});

describe("staticDockerfile", () => {
  it("serves the publish dir over busybox httpd on the app port", () => {
    const df = staticDockerfile({ publishDir: "dist", port: 8080 });
    expect(df).toContain("FROM busybox");
    expect(df).toContain("COPY dist/ /www/");
    expect(df).toContain("EXPOSE 8080");
    expect(df).toContain('"httpd"');
    expect(df).toContain('"-p","8080"');
    expect(df).toContain('"-h","/www"');
  });

  it("serves the whole context when the publish dir is the root", () => {
    expect(staticDockerfile({ publishDir: ".", port: 3000 })).toContain("COPY ./ /www/");
  });
});
