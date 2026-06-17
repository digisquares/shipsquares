import { describe, expect, it } from "vitest";

import type { S3Destination } from "./commands.js";
import {
  baseBackupCommandHost,
  chownDirCommand,
  containerRecoveryConfig,
  createSlotCommandHost,
  currentLsnCommandHost,
  dropSlotCommandHost,
  parseLsn,
  parsePgVersion,
  pgIsInRecoveryCommand,
  recoveryConfig,
  restoreBaseCommand,
  restoreBundleCommand,
  restoreContainerRunCommand,
  restorePlanSteps,
  stageWalCommand,
  walDrainCommandHost,
  walSyncCommand,
  type PgHostTarget,
} from "./pitr.js";

const t: PgHostTarget = {
  host: "db.example.com",
  port: 5432,
  user: "postgres",
  password: "p@ss'w",
};
const dest: S3Destination = {
  provider: "AWS",
  accessKeyId: "AK",
  secretAccessKey: "SK",
  region: "us-east-1",
  bucket: "buk",
};

describe("pitr composers", () => {
  it("base backup stages to a dir (multi-tablespace) then bundles it to stdout", () => {
    const c = baseBackupCommandHost(t, "/var/lib/shipsquares/base/bkc_1");
    expect(c).toContain("pg_basebackup");
    expect(c).toContain("-D '/var/lib/shipsquares/base/bkc_1' -F t -X fetch -z");
    expect(c).toContain("mkdir -p '/var/lib/shipsquares/base/bkc_1'");
    expect(c).toContain("tar -c -C '/var/lib/shipsquares/base/bkc_1' .");
    expect(c).toContain("-h 'db.example.com' -p 5432 -U 'postgres' -w");
    // password rides env, single-quote-escaped, never argv
    expect(c).toContain("PGPASSWORD='p@ss'\\''w'");
    expect(c).not.toContain("--password");
  });

  it("slot create/drop are idempotent + SQL/shell escaped", () => {
    const create = createSlotCommandHost(t, "ss_pitr_x");
    expect(create).toContain("pg_create_physical_replication_slot");
    expect(create).toContain("WHERE NOT EXISTS");
    expect(create).toContain("ON_ERROR_STOP=1");
    const drop = dropSlotCommandHost(t, "ss_pitr_x");
    expect(drop).toContain("pg_drop_replication_slot");
    expect(drop).toContain("WHERE EXISTS");
  });

  it("current LSN is read with psql -tAc", () => {
    expect(currentLsnCommandHost(t)).toContain("SELECT pg_current_wal_lsn()");
  });

  it("drain receives up to an endpos and exits (--no-loop)", () => {
    const c = walDrainCommandHost(t, "/var/lib/shipsquares/wal/bkc_1", "ss_pitr_x", "0/3000060");
    expect(c).toContain("pg_receivewal");
    expect(c).toContain("--slot='ss_pitr_x'");
    expect(c).toContain("--no-loop");
    expect(c).toContain("--endpos='0/3000060'");
    expect(c).toContain("-D '/var/lib/shipsquares/wal/bkc_1'");
  });

  it("wal sync moves completed .gz segments + .history timeline files to S3", () => {
    const c = walSyncCommand("/spool", dest, "org/srv/wal");
    expect(c.startsWith("rclone move '/spool' ")).toBe(true);
    expect(c).toContain("--include '*.gz'");
    expect(c).toContain("--include '*.history'");
    expect(c).toContain(":s3,");
    expect(c).toContain("buk/org/srv/wal");
  });

  it("parseLsn accepts a PG LSN and rejects junk", () => {
    expect(parseLsn(" 0/3000060 \n")).toBe("0/3000060");
    expect(parseLsn("16/B374D848")).toBe("16/B374D848");
    expect(parseLsn("ERROR: nope")).toBeNull();
    expect(parseLsn("")).toBeNull();
  });

  it("recoveryConfig fetches gz WAL by %f and targets a time when given", () => {
    const noTarget = recoveryConfig(dest, "org/srv/wal");
    expect(noTarget).toContain("restore_command = 'rclone cat ");
    expect(noTarget).toContain("/%f.gz | gunzip -c > %p'");
    expect(noTarget).not.toContain("recovery_target_time");
    const withTarget = recoveryConfig(dest, "org/srv/wal", "2026-06-14T12:00:00Z");
    expect(withTarget).toContain("recovery_target_time = '2026-06-14T12:00:00Z'");
    expect(withTarget).toContain("recovery_target_action = 'promote'");
  });

  it("restoreBaseCommand pulls base.tar.gz out of the bundle into the data dir", () => {
    const c = restoreBaseCommand(dest, "org/srv/base/b.tar", "/data");
    expect(c).toContain("rclone cat ");
    expect(c).toContain("tar -xO --wildcards '*base.tar.gz'");
    expect(c).toContain("| tar -xz -C '/data'");
  });

  it("restorePlanSteps is an ordered runbook from stop to start", () => {
    const steps = restorePlanSteps({
      dest,
      baseLocation: "org/srv/base/b.tar.gz",
      walPrefix: "org/srv/wal",
      dataDir: "/var/lib/postgresql/16/main",
      targetTime: "2026-06-14T12:00:00Z",
    });
    expect(steps[0]?.title).toContain("Stop");
    expect(steps.at(-1)?.command).toContain("pg_ctl");
    expect(steps.some((s) => s.command.includes("recovery.signal"))).toBe(true);
    expect(steps.some((s) => s.command.includes("tar -xz -C"))).toBe(true);
    expect(steps.some((s) => s.command.includes("recovery_target_time"))).toBe(true);
  });
});

describe("pitr automated-restore composers", () => {
  it("stages WAL (segments + .history) from S3 into the local mount dir", () => {
    const c = stageWalCommand(dest, "org/srv/wal", "/restore/wal");
    expect(c.startsWith("rclone copy ")).toBe(true);
    expect(c).toContain("buk/org/srv/wal");
    expect(c).toContain("'/restore/wal'");
    expect(c).toContain("--include '*.gz'");
    expect(c).toContain("--include '*.history'");
  });

  it("container recovery config reads /wal, falling back to a plain copy for .history", () => {
    const noTarget = containerRecoveryConfig();
    expect(noTarget).toContain(
      "restore_command = 'gunzip -c /wal/%f.gz > %p 2>/dev/null || cp /wal/%f %p'",
    );
    expect(noTarget).not.toContain("recovery_target_time");
    const withTarget = containerRecoveryConfig("2026-06-15T00:00:00Z");
    expect(withTarget).toContain("recovery_target_time = '2026-06-15T00:00:00Z'");
    expect(withTarget).toContain("recovery_target_action = 'promote'");
  });

  it("chowns a dir to the image uid via a throwaway root container", () => {
    expect(chownDirCommand("/restore")).toBe(
      "docker run --rm -v '/restore':/d alpine chown -R 999:999 /d",
    );
  });

  it("starts the restore container with data + ro wal + tablespace mounts", () => {
    const c = restoreContainerRunCommand(
      "ss-restore-x",
      "/restore/data",
      "/restore/wal",
      "/restore/tbs",
      55432,
      "postgres:16",
    );
    expect(c).toContain("docker run -d --name 'ss-restore-x'");
    expect(c).toContain("-v '/restore/data':/var/lib/postgresql/data");
    expect(c).toContain("-v '/restore/wal':/wal:ro");
    expect(c).toContain("-v '/restore/tbs':/tbs");
    expect(c).toContain("-p 127.0.0.1:55432:5432");
    expect(c).toContain("'postgres:16'");
  });

  it("restoreBundleCommand unpacks the bundle + re-maps each tablespace", () => {
    const c = restoreBundleCommand(dest, "org/srv/base/b.tar", "/r/data", "/r/unpack", "/r/tbs");
    expect(c).toContain("rclone cat ");
    expect(c).toContain("tar -x -C '/r/unpack'");
    expect(c).toContain("tar -xz -C '/r/data' -f '/r/unpack'/base.tar.gz");
    expect(c).toContain("for f in '/r/unpack'/*.tar.gz");
    expect(c).toContain("tablespace_map");
    expect(c).toContain("/tbs/");
  });

  it("probes recovery state inside the container", () => {
    const c = pgIsInRecoveryCommand("ss-restore-x");
    expect(c).toContain("docker exec 'ss-restore-x' psql");
    expect(c).toContain("pg_is_in_recovery()");
  });

  it("parsePgVersion accepts the major version and rejects junk", () => {
    expect(parsePgVersion("16\n")).toBe("16");
    expect(parsePgVersion(" 9 ")).toBe("9");
    expect(parsePgVersion("16.2")).toBeNull();
    expect(parsePgVersion("")).toBeNull();
  });
});
