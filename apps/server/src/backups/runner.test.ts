import { describe, expect, it, vi } from "vitest";

import { runBackup, type BackupRunDeps, type BackupSpec } from "./runner.js";

const AT = new Date("2026-06-10T12:00:00.000Z");

const spec: BackupSpec = {
  dump: "pg_dump -Fc 'shop' | gzip",
  database: "shop",
  dest: {
    provider: "AWS",
    accessKeyId: "AK",
    secretAccessKey: "SK",
    region: "eu-central-1",
    bucket: "backups",
  },
  prefix: "org_1/shop",
  keep: 7,
};

function makeDeps(over: Partial<BackupRunDeps> = {}) {
  const finished: Record<string, unknown>[] = [];
  const deps: BackupRunDeps = {
    exec: vi.fn(async () => ({ code: 0, lines: [] })),
    record: {
      start: vi.fn(async () => "bkp_1"),
      finish: vi.fn(async (_id, patch) => {
        finished.push(patch);
      }),
    },
    now: () => AT,
    ...over,
  };
  return { deps, finished };
}

describe("runBackup", () => {
  it("composes dump→upload, records start + success with the remote location", async () => {
    const { deps, finished } = makeDeps();
    const r = await runBackup(spec, deps);
    expect(r.ok).toBe(true);
    expect(deps.record.start).toHaveBeenCalledTimes(1);
    const upload = (deps.exec as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(upload).toContain("pg_dump -Fc 'shop' | gzip");
    expect(upload).toContain("rclone rcat");
    expect(upload).toContain("org_1/shop/shop-2026-06-10T12-00-00.dump.gz");
    // location is a CREDENTIAL-FREE display path (prefix/filename) — the inline
    // rclone remote embeds the S3 secret and must never land in a DB column.
    expect(finished[0]).toMatchObject({
      status: "success",
      location: "org_1/shop/shop-2026-06-10T12-00-00.dump.gz",
    });
    expect(JSON.stringify(finished[0])).not.toContain("SK");
  });

  it("size probe + retention run only after success; their failures never flip the status", async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, lines: [] }) // upload
      .mockResolvedValueOnce({ code: 1, lines: [] }) // size probe fails
      .mockRejectedValueOnce(new Error("rclone gone")); // retention list throws
    const { deps, finished } = makeDeps({ exec });
    const r = await runBackup(spec, deps);
    expect(r.ok).toBe(true);
    expect(exec).toHaveBeenCalledTimes(3);
    expect(exec.mock.calls[1]![0] as string).toContain("rclone size");
    expect(exec.mock.calls[2]![0] as string).toContain("rclone lsf");
    expect(finished[0]).toMatchObject({ status: "success" });
    expect(finished[0]).not.toHaveProperty("sizeBytes");
  });

  it("records sizeBytes parsed from the rclone size JSON", async () => {
    const exec = vi.fn(async (command: string) => {
      if (command.includes("rclone size")) {
        return {
          code: 0,
          lines: [{ stream: "stdout" as const, line: '{"count":1,"bytes":10485760}' }],
        };
      }
      return { code: 0, lines: [] };
    });
    const { deps, finished } = makeDeps({ exec });
    const r = await runBackup(spec, deps);
    expect(r.ok).toBe(true);
    expect(finished[0]).toMatchObject({ status: "success", sizeBytes: 10_485_760 });
  });

  it("garbled size output leaves sizeBytes unset on a successful run", async () => {
    const exec = vi.fn(async (command: string) => {
      if (command.includes("rclone size")) {
        return { code: 0, lines: [{ stream: "stdout" as const, line: "not json" }] };
      }
      return { code: 0, lines: [] };
    });
    const { deps, finished } = makeDeps({ exec });
    const r = await runBackup(spec, deps);
    expect(r.ok).toBe(true);
    expect(finished[0]).toMatchObject({ status: "success" });
    expect(finished[0]).not.toHaveProperty("sizeBytes");
  });

  it("calendar retention keeps newest-N plus the window and never touches foreign files", async () => {
    const listing = [
      "shop-2026-06-10T12-00-00.dump.gz", // the run itself (newest, kept by keep)
      "shop-2026-06-09T12-00-00.dump.gz", // 1d old — inside the 2d window, kept
      "shop-2026-06-08T11-59-00.dump.gz", // just outside the window — pruned
      "shop-2026-05-30T12-00-00.dump.gz", // 11d old — pruned
      "notes.txt", // foreign file — never pruned
    ];
    const deletes: string[] = [];
    const exec = vi.fn(async (command: string) => {
      if (command.includes("rclone lsf")) {
        return { code: 0, lines: listing.map((line) => ({ stream: "stdout" as const, line })) };
      }
      if (command.includes("rclone deletefile")) deletes.push(command);
      return { code: 0, lines: [] };
    });
    const { deps, finished } = makeDeps({ exec });
    const r = await runBackup({ ...spec, keep: 1, retentionMs: 2 * 24 * 60 * 60 * 1000 }, deps);
    expect(r.ok).toBe(true);
    expect(finished[0]).toMatchObject({ status: "success" });
    expect(deletes).toHaveLength(2);
    expect(deletes[0]).toContain("org_1/shop/shop-2026-06-08T11-59-00.dump.gz");
    expect(deletes[1]).toContain("org_1/shop/shop-2026-05-30T12-00-00.dump.gz");
    for (const d of deletes) {
      expect(d).not.toContain("notes.txt");
      expect(d).not.toContain("2026-06-09");
      expect(d).not.toContain("2026-06-10");
    }
  });

  it("a failed retention listing skips pruning but the run still succeeds", async () => {
    const deletes: string[] = [];
    const exec = vi.fn(async (command: string) => {
      if (command.includes("rclone lsf")) return { code: 1, lines: [] };
      if (command.includes("rclone deletefile")) deletes.push(command);
      return { code: 0, lines: [] };
    });
    const { deps, finished } = makeDeps({ exec });
    const r = await runBackup(spec, deps);
    expect(r.ok).toBe(true);
    expect(deletes).toHaveLength(0);
    expect(finished[0]).toMatchObject({ status: "success" });
  });

  it("a failed dump records failed with the stderr tail and skips retention", async () => {
    const exec = vi.fn(async () => ({
      code: 1,
      lines: [{ stream: "stderr" as const, line: "pg_dump: connection refused" }],
    }));
    const { deps, finished } = makeDeps({ exec });
    const r = await runBackup(spec, deps);
    expect(r.ok).toBe(false);
    expect(exec).toHaveBeenCalledTimes(1); // no retention attempt
    expect(finished[0]).toMatchObject({ status: "failed" });
    expect(String((finished[0] as { error?: string }).error)).toContain("connection refused");
  });

  it("an exec throw is recorded as failed, never thrown to the caller", async () => {
    const exec = vi.fn(async () => {
      throw new Error("ssh unreachable");
    });
    const { deps, finished } = makeDeps({ exec });
    const r = await runBackup(spec, deps);
    expect(r.ok).toBe(false);
    expect(finished[0]).toMatchObject({ status: "failed", error: "ssh unreachable" });
  });

  it("scrubs the S3 secret from a failure's stderr before recording it (M4)", async () => {
    const secretSpec: BackupSpec = {
      ...spec,
      dest: {
        ...spec.dest,
        secretAccessKey: "s3cretAccessKeyValue123",
        accessKeyId: "AKIAEXAMPLE1",
      },
    };
    const exec = vi.fn(async () => ({
      code: 1,
      lines: [
        {
          stream: "stderr" as const,
          line: "Failed to create file system for :s3,access_key_id=AKIAEXAMPLE1,secret_access_key=s3cretAccessKeyValue123:backups",
        },
      ],
    }));
    const { deps, finished } = makeDeps({ exec });
    const r = await runBackup(secretSpec, deps);
    expect(r.ok).toBe(false);
    const error = String((finished[0] as { error?: string }).error);
    expect(error).not.toContain("s3cretAccessKeyValue123");
    expect(error).not.toContain("AKIAEXAMPLE1");
    expect(error).toContain("***");
  });
});
