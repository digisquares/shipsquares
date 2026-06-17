import { describe, expect, it, vi } from "vitest";

import type { S3Destination } from "./commands.js";
import { runRestore, type ExecResult } from "./restore.js";

const dest: S3Destination = {
  provider: "Minio",
  accessKeyId: "AK",
  secretAccessKey: "SK",
  bucket: "b",
};
const spec = {
  dest,
  baseLocation: "p/base/b.tar.gz",
  walPrefix: "p/wal",
  stagingDir: "/var/lib/shipsquares/restore/bkc_1",
  containerName: "ss-restore-bkc_1",
  port: 55432,
  pollAttempts: 3,
};
const ok = (out = ""): ExecResult => ({
  code: 0,
  lines: out ? [{ stream: "stdout", line: out }] : [],
});
const fail = (err: string): ExecResult => ({ code: 1, lines: [{ stream: "stderr", line: err }] });
const noSleep = { sleep: () => Promise.resolve() };

describe("runRestore", () => {
  it("stages base+WAL, configures recovery, starts the container, polls until promoted", async () => {
    const cmds: string[] = [];
    let polls = 0;
    const exec = vi.fn(async (c: string) => {
      cmds.push(c);
      if (c.includes("PG_VERSION")) return ok("16\n");
      if (c.includes("pg_is_in_recovery")) {
        polls += 1;
        return ok(polls >= 2 ? "f" : "t");
      }
      return ok();
    });
    const r = await runRestore(spec, { exec, ...noSleep });
    expect(r).toMatchObject({
      ok: true,
      recovered: true,
      pgVersion: "16",
      port: 55432,
      container: "ss-restore-bkc_1",
    });
    // ordered: staging → base → version → wal → recovery conf → chown → run → poll
    expect(cmds[0]).toContain("mkdir -p");
    expect(cmds[1]).toContain("rclone cat"); // base bundle download
    expect(cmds[1]).toContain("for f in"); // per-tablespace re-map loop
    expect(cmds[2]).toContain("PG_VERSION");
    expect(cmds[3]).toContain("rclone copy"); // wal stage
    expect(cmds.some((c) => c.includes("recovery.signal"))).toBe(true);
    expect(cmds.some((c) => c.includes("chown -R 999:999"))).toBe(true);
    expect(cmds.some((c) => c.includes("docker run -d --name 'ss-restore-bkc_1'"))).toBe(true);
    expect(cmds.some((c) => c.includes(":/tbs"))).toBe(true);
    expect(cmds.some((c) => c.includes("postgres:16"))).toBe(true);
  });

  it("fails clearly when the base download/extract fails", async () => {
    const exec = async (c: string): Promise<ExecResult> =>
      c.includes("tar -xz") ? fail("no such object") : ok();
    const r = await runRestore(spec, { exec, ...noSleep });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("base download/extract failed");
  });

  it("fails when PG_VERSION can't be read", async () => {
    const exec = async (c: string): Promise<ExecResult> =>
      c.includes("PG_VERSION") ? fail("missing") : ok();
    const r = await runRestore(spec, { exec, ...noSleep });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("PG_VERSION");
  });

  it("reports not-recovered if it never leaves recovery within the poll window", async () => {
    const exec = async (c: string): Promise<ExecResult> => {
      if (c.includes("PG_VERSION")) return ok("16");
      if (c.includes("pg_is_in_recovery")) return ok("t");
      return ok();
    };
    const r = await runRestore(spec, { exec, ...noSleep });
    expect(r).toMatchObject({ ok: false, recovered: false, pgVersion: "16" });
    expect(r.error).toContain("did not finish recovery");
  });
});
