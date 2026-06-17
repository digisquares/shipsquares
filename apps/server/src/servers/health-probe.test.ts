import { describe, expect, it } from "vitest";

import {
  parseDockerVersion,
  parseDiskUsage,
  decideServerStatus,
  isDiskCritical,
} from "./health-probe.js";

describe("health-probe", () => {
  describe("parseDockerVersion", () => {
    it("parses valid docker version", () => {
      const result = parseDockerVersion("24.0.7", 0);
      expect(result.ok).toBe(true);
      expect(result.version).toBe("24.0.7");
    });

    it("parses version with patch", () => {
      const result = parseDockerVersion("20.10.21\n", 0);
      expect(result.ok).toBe(true);
      expect(result.version).toBe("20.10.21");
    });

    it("fails on non-zero exit code", () => {
      const result = parseDockerVersion("", 1);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("exit code 1");
    });

    it("fails on connection error output", () => {
      const result = parseDockerVersion("Cannot connect to the Docker daemon", 0);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("not running");
    });

    it("fails on invalid version format", () => {
      const result = parseDockerVersion("invalid", 0);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("unexpected");
    });

    it("fails on empty output", () => {
      const result = parseDockerVersion("", 0);
      expect(result.ok).toBe(false);
    });
  });

  describe("parseDiskUsage", () => {
    it("parses valid df output", () => {
      const output = `Filesystem     1K-blocks     Used Available Use% Mounted on
/dev/sda1      103081248 41232512  56585984  42% /`;
      const result = parseDiskUsage(output, 0);
      expect(result.ok).toBe(true);
      expect(result.usedPct).toBe(42);
      expect(result.usedBytes).toBe(41232512 * 1024);
      expect(result.totalBytes).toBe(103081248 * 1024);
    });

    it("handles 100% usage", () => {
      const output = `Filesystem     1K-blocks     Used Available Use% Mounted on
/dev/sda1      100000000 100000000        0 100% /`;
      const result = parseDiskUsage(output, 0);
      expect(result.ok).toBe(true);
      expect(result.usedPct).toBe(100);
    });

    it("fails on non-zero exit code", () => {
      const result = parseDiskUsage("", 1);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("exit code 1");
    });

    it("fails on missing data line", () => {
      const output = `Filesystem     1K-blocks     Used Available Use% Mounted on`;
      const result = parseDiskUsage(output, 0);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("no data line");
    });
  });

  describe("decideServerStatus", () => {
    const healthyProbe = {
      reachable: true,
      docker: { ok: true, version: "24.0.7" },
      disk: { ok: true, usedPct: 50 },
    };

    const unreachableProbe = {
      reachable: false,
      docker: { ok: false, error: "connection refused" },
      disk: { ok: false, error: "connection refused" },
    };

    const dockerBrokenProbe = {
      reachable: true,
      docker: { ok: false, error: "docker not running" },
      disk: { ok: true, usedPct: 50 },
    };

    it("transitions ready to unreachable when not reachable", () => {
      expect(decideServerStatus("ready", unreachableProbe)).toBe("unreachable");
    });

    it("does not change adding when unreachable", () => {
      expect(decideServerStatus("adding", unreachableProbe)).toBeNull();
    });

    it("does not change bootstrapping when unreachable", () => {
      expect(decideServerStatus("bootstrapping", unreachableProbe)).toBeNull();
    });

    it("transitions unreachable to ready when healthy", () => {
      expect(decideServerStatus("unreachable", healthyProbe)).toBe("ready");
    });

    it("transitions ready to error when docker broken", () => {
      expect(decideServerStatus("ready", dockerBrokenProbe)).toBe("error");
    });

    it("transitions unreachable to error when reachable but docker broken", () => {
      expect(decideServerStatus("unreachable", dockerBrokenProbe)).toBe("error");
    });

    it("returns null when already ready and healthy", () => {
      expect(decideServerStatus("ready", healthyProbe)).toBeNull();
    });
  });

  describe("isDiskCritical", () => {
    it("returns true when usage exceeds threshold", () => {
      expect(isDiskCritical({ ok: true, usedPct: 85 }, 80)).toBe(true);
    });

    it("returns true when usage equals threshold", () => {
      expect(isDiskCritical({ ok: true, usedPct: 80 }, 80)).toBe(true);
    });

    it("returns false when usage below threshold", () => {
      expect(isDiskCritical({ ok: true, usedPct: 75 }, 80)).toBe(false);
    });

    it("returns false when disk probe failed", () => {
      expect(isDiskCritical({ ok: false, error: "df failed" }, 80)).toBe(false);
    });

    it("returns false when usedPct undefined", () => {
      expect(isDiskCritical({ ok: true }, 80)).toBe(false);
    });
  });
});
