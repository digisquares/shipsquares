import { describe, expect, it } from "vitest";

import { formatApps, formatMetrics, table } from "./format.js";

describe("table", () => {
  it("pads columns to align and keeps the header row", () => {
    const out = table(
      ["A", "BB"],
      [
        ["x", "y"],
        ["longer", "z"],
      ],
    );
    const lines = out.split("\n");
    expect(lines[0]).toContain("A");
    expect(lines).toHaveLength(3);
    // every data cell in column 0 starts at the same offset
    expect(lines[1]?.indexOf("x")).toBe(0);
    expect(lines[2]?.indexOf("longer")).toBe(0);
  });
});

describe("formatApps / formatMetrics", () => {
  it("renders an app table and an empty message", () => {
    expect(formatApps([])).toBe("No apps.");
    const out = formatApps([
      { id: "app_1", name: "api", repo: "git@x", image: null, branch: "main" },
    ]);
    expect(out).toContain("api");
    expect(out).toContain("git@x");
    expect(out).toContain("main");
  });

  it("renders running vs stopped metrics", () => {
    expect(formatMetrics({ running: false })).toContain("stopped");
    const out = formatMetrics({
      running: true,
      cpuPercent: 12.34,
      memPercent: 5,
      memUsage: "1MiB / 2MiB",
    });
    expect(out).toContain("12.3%");
    expect(out).toContain("1MiB / 2MiB");
  });
});
