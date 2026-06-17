import { describe, expect, it, vi } from "vitest";

import type { S3Destination } from "./commands.js";
import type { PgHostTarget } from "./pitr.js";
import { runWalArchive, type ExecResult } from "./wal.js";

const target: PgHostTarget = { host: "h", port: 5432, user: "postgres", password: "pw" };
const dest: S3Destination = {
  provider: "AWS",
  accessKeyId: "AK",
  secretAccessKey: "SK",
  bucket: "b",
};
const spec = { target, slot: "ss_pitr_1", spoolDir: "/spool", dest, walPrefix: "org/srv/wal" };

const ok = (out = ""): ExecResult => ({
  code: 0,
  lines: out ? [{ stream: "stdout", line: out }] : [],
});
const fail = (err: string): ExecResult => ({ code: 1, lines: [{ stream: "stderr", line: err }] });

describe("runWalArchive", () => {
  it("creates the slot, reads the LSN, drains to it, uploads — in order", async () => {
    const cmds: string[] = [];
    const exec = vi.fn(async (c: string) => {
      cmds.push(c);
      return c.includes("pg_current_wal_lsn") ? ok("0/3000060") : ok();
    });
    const r = await runWalArchive(spec, { exec });
    expect(r).toEqual({ ok: true, lsn: "0/3000060" });
    expect(cmds[0]).toContain("mkdir -p");
    expect(cmds[1]).toContain("pg_create_physical_replication_slot");
    expect(cmds[2]).toContain("pg_current_wal_lsn");
    expect(cmds[3]).toContain("--endpos='0/3000060'");
    expect(cmds[4]).toContain("rclone move");
  });

  it("fails clearly when the current LSN can't be read", async () => {
    const exec = async (c: string): Promise<ExecResult> =>
      c.includes("pg_current_wal_lsn") ? fail("could not connect to server") : ok();
    const r = await runWalArchive(spec, { exec });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("current LSN");
  });

  it("surfaces a drain failure with the LSN it targeted", async () => {
    const exec = async (c: string): Promise<ExecResult> => {
      if (c.includes("pg_current_wal_lsn")) return ok("0/A");
      if (c.includes("pg_receivewal")) return fail("wal_level is minimal");
      return ok();
    };
    const r = await runWalArchive(spec, { exec });
    expect(r).toMatchObject({ ok: false, lsn: "0/A" });
    expect(r.error).toContain("wal drain failed");
  });

  it("stops if slot creation fails (e.g. not a superuser)", async () => {
    const exec = async (c: string): Promise<ExecResult> =>
      c.includes("pg_create_physical_replication_slot") ? fail("permission denied") : ok();
    const r = await runWalArchive(spec, { exec });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("slot create failed");
  });
});
