import { describe, expect, it } from "vitest";

import { isValidCron, jobExecCommand, nextCronRun, scheduleQueueName, tailOutput } from "./core.js";

describe("isValidCron (5-field pg-boss cron)", () => {
  it("accepts common expressions", () => {
    for (const ok of ["* * * * *", "*/5 * * * *", "0 3 * * 1-5", "15,45 8-18 * * *"]) {
      expect(isValidCron(ok), ok).toBe(true);
    }
  });

  it("rejects wrong field counts and junk", () => {
    for (const bad of ["* * * *", "* * * * * *", "boom * * * *", "", "0 3 * * mon"]) {
      expect(isValidCron(bad), bad).toBe(false);
    }
  });

  it("rejects out-of-range fields (would throw later in boss.schedule)", () => {
    for (const bad of [
      "70 * * * *", // minute > 59
      "* 24 * * *", // hour > 23
      "* * 32 * *", // day-of-month > 31
      "* * 0 * *", // day-of-month < 1
      "* * * 13 *", // month > 12
      "* * * * 8-9", // day-of-week range out of 0-7
      "*/0 * * * *", // zero step
      "5-1 * * * *", // inverted range
    ]) {
      expect(isValidCron(bad), bad).toBe(false);
    }
    expect(isValidCron("* * * * 7")).toBe(true); // 7 == Sunday, valid
  });
});

describe("nextCronRun (next UTC fire time)", () => {
  it("finds the next daily run later today, else tomorrow", () => {
    expect(nextCronRun("0 3 * * *", new Date("2026-06-15T01:00:00Z"))?.toISOString()).toBe(
      "2026-06-15T03:00:00.000Z",
    );
    expect(nextCronRun("0 3 * * *", new Date("2026-06-15T05:00:00Z"))?.toISOString()).toBe(
      "2026-06-16T03:00:00.000Z",
    );
  });

  it("steps to the next interval boundary", () => {
    expect(nextCronRun("*/15 * * * *", new Date("2026-06-15T01:05:00Z"))?.toISOString()).toBe(
      "2026-06-15T01:15:00.000Z",
    );
  });

  it("honours day-of-week (0 and 7 both = Sunday)", () => {
    // 2026-06-17 is a Wednesday → the next Sunday is 2026-06-21
    expect(nextCronRun("0 0 * * 0", new Date("2026-06-17T12:00:00Z"))?.toISOString()).toBe(
      "2026-06-21T00:00:00.000Z",
    );
    expect(nextCronRun("0 0 * * 7", new Date("2026-06-17T12:00:00Z"))?.toISOString()).toBe(
      "2026-06-21T00:00:00.000Z",
    );
  });

  it("finds the first of next month and rejects junk", () => {
    expect(nextCronRun("0 0 1 * *", new Date("2026-06-15T00:00:00Z"))?.toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
    expect(nextCronRun("nope", new Date("2026-06-15T00:00:00Z"))).toBeNull();
  });
});

describe("scheduleQueueName", () => {
  it("derives a per-job pg-boss queue name", () => {
    expect(scheduleQueueName("job_abc")).toBe("schedule:job_abc");
  });
});

describe("jobExecCommand", () => {
  it("container target: docker exec with the chosen shell, command single-quoted", () => {
    expect(
      jobExecCommand({
        target: "app_container",
        container: "ss-app_1",
        shell: "sh",
        command: "echo hi",
      }),
    ).toBe("docker exec 'ss-app_1' sh -c 'echo hi'");
  });

  it("escapes embedded quotes so injection stays inert (exact form)", () => {
    expect(
      jobExecCommand({
        target: "app_container",
        container: "ss-app_1",
        shell: "bash",
        command: "echo 'x'; rm -rf /",
      }),
    ).toBe("docker exec 'ss-app_1' bash -c 'echo '\\''x'\\''; rm -rf /'");
  });

  it("rejects shells outside the allowlist", () => {
    expect(() =>
      jobExecCommand({ target: "app_container", container: "c", shell: "zsh", command: "x" }),
    ).toThrow(/shell/);
  });

  it("server target: the command runs on the host as-is", () => {
    expect(jobExecCommand({ target: "server", shell: "bash", command: "df -h" })).toBe("df -h");
  });
});

describe("tailOutput", () => {
  it("keeps the last N lines", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line-${i}`);
    const out = tailOutput(lines, 3, 10_000);
    expect(out).toBe("line-7\nline-8\nline-9");
  });

  it("byte-clamps pathological output from the front", () => {
    const out = tailOutput(["x".repeat(100)], 10, 16);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(16);
    expect(out.endsWith("x")).toBe(true); // the tail survives, the head is cut
  });
});
