import { describe, expect, it } from "vitest";

import { hostCpuPct, parseDfRoot, parseDockerStatsLine, parseMemUsage } from "./stats-parse.js";

describe("parseMemUsage", () => {
  it("parses docker's used/limit pairs across units", () => {
    expect(parseMemUsage("12.5MiB / 1.944GiB")).toEqual({
      used: Math.round(12.5 * 1024 ** 2),
      limit: Math.round(1.944 * 1024 ** 3),
    });
    expect(parseMemUsage("512KiB / 128MiB")).toEqual({
      used: 512 * 1024,
      limit: 128 * 1024 ** 2,
    });
  });

  it("returns null for garbage", () => {
    expect(parseMemUsage("")).toBeNull();
    expect(parseMemUsage("n/a")).toBeNull();
  });
});

describe("parseDockerStatsLine", () => {
  it("extracts id, cpu and memory bytes from a stats JSON line", () => {
    const line = JSON.stringify({
      ID: "abc123",
      Name: "ss-app_x-web-1",
      CPUPerc: "1.52%",
      MemUsage: "100MiB / 1GiB",
    });
    expect(parseDockerStatsLine(line)).toEqual({
      id: "abc123",
      cpuPct: 1.52,
      memBytes: 100 * 1024 ** 2,
      memLimitBytes: 1024 ** 3,
    });
  });

  it("returns null on malformed json", () => {
    expect(parseDockerStatsLine("not json")).toBeNull();
  });
});

describe("parseDfRoot", () => {
  it("reads used/total KiB from `df -kP /` output", () => {
    const out =
      "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 30298176 6815744 23482432 23% /";
    expect(parseDfRoot(out)).toEqual({
      usedBytes: 6815744 * 1024,
      totalBytes: 30298176 * 1024,
    });
  });

  it("returns null when no data row exists", () => {
    expect(parseDfRoot("Filesystem 1024-blocks Used Available Capacity Mounted on")).toBeNull();
  });
});

describe("hostCpuPct", () => {
  it("normalizes loadavg by core count and clamps to 100", () => {
    expect(hostCpuPct(1, 4)).toBe(25);
    expect(hostCpuPct(9, 4)).toBe(100);
    expect(hostCpuPct(0, 4)).toBe(0);
  });
});
