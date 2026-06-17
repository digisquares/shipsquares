import {
  backupFilename,
  deleteFileCommand,
  listFilesCommand,
  parseBackupTimestamp,
  s3Remote,
  sizeCommand,
  uploadPipeline,
  type S3Destination,
} from "./commands.js";
import { selectBackupsToPrune } from "./retention.js";

// Backup run orchestration (27-db-backup-replication.md): compose the tested
// dump→upload pipeline, record the run (with its artifact size), and apply
// keep-N ∪ N-days retention after a success. Exec/record/clock are injected,
// so the whole engine is unit-tested; the service adapter binds runCommand
// (local) or the 09 SSH substrate (remote) plus the db_backups table. Never
// throws — failures land in the row.

export interface BackupSpec {
  /** the composed dump pipeline (dumpCommand for containers, dumpCommandHost
   *  for the managed host PG) — already shell-safe via the tested composers */
  dump: string;
  /** database name — drives the sortable backup filename */
  database: string;
  /** artifact extension (default "dump.gz"; physical base backups use "tar.gz") */
  ext?: string;
  dest: S3Destination;
  /** remote directory under the bucket, e.g. "<org>/<database>" */
  prefix: string;
  /** keep the newest N backups in the prefix */
  keep: number;
  /** additionally keep anything younger than this window (calendar retention) */
  retentionMs?: number;
}

export interface BackupRunDeps {
  exec: (
    command: string,
  ) => Promise<{ code: number; timedOut?: boolean; lines: { stream: string; line: string }[] }>;
  record: {
    start(): Promise<string>;
    finish(id: string, patch: Record<string, unknown>): Promise<void>;
  };
  now: () => Date;
}

export interface BackupRunResult {
  ok: boolean;
  location?: string;
  error?: string;
}

const ERROR_TAIL_LINES = 5;

export async function runBackup(spec: BackupSpec, deps: BackupRunDeps): Promise<BackupRunResult> {
  const filename = backupFilename(spec.database, deps.now(), spec.ext);
  // The inline rclone remote embeds the S3 secret — it is composed here, used
  // for the command, and NEVER recorded. The stored location is the
  // credential-free bucket-relative path; restores recompose the remote from
  // the sealed destination.
  const location = `${spec.prefix}/${filename}`;
  const remote = s3Remote(spec.dest, location);
  const command = uploadPipeline(spec.dump, remote);

  const runId = await deps.record.start();
  const finish = async (patch: Record<string, unknown>): Promise<void> => {
    await deps.record.finish(runId, { finishedAt: deps.now(), ...patch }).catch(() => undefined);
  };

  try {
    const res = await deps.exec(command);
    if (res.code !== 0) {
      const tail = res.lines
        .filter((l) => l.stream === "stderr")
        .slice(-ERROR_TAIL_LINES)
        .map((l) => l.line)
        .join("\n");
      const error = `backup failed (exit ${res.code}${res.timedOut ? ", timed out" : ""})${tail ? `: ${tail}` : ""}`;
      await finish({ status: "failed", error });
      return { ok: false, error };
    }
    // Size probe + retention are best-effort and only after a confirmed
    // upload — a hiccup in either must never mark a good backup failed.
    const sizeBytes = await probeSize(remote, deps);
    await applyRetention(spec, deps);
    await finish({ status: "success", location, ...(sizeBytes === null ? {} : { sizeBytes }) });
    return { ok: true, location };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await finish({ status: "failed", error });
    return { ok: false, error };
  }
}

async function probeSize(remote: string, deps: BackupRunDeps): Promise<number | null> {
  try {
    const res = await deps.exec(sizeCommand(remote));
    if (res.code !== 0) return null;
    for (const l of res.lines) {
      if (l.stream !== "stdout") continue;
      try {
        const parsed = JSON.parse(l.line) as { bytes?: unknown };
        if (typeof parsed.bytes === "number") return parsed.bytes;
      } catch {
        // not the JSON line
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** keep-N ∪ N-days over the prefix: list, parse the filename stamps (foreign
 *  files parse to null and are untouchable), prune the rest one object at a
 *  time. The just-uploaded file's stamp equals now, so it always survives. */
async function applyRetention(spec: BackupSpec, deps: BackupRunDeps): Promise<void> {
  try {
    const res = await deps.exec(listFilesCommand(s3Remote(spec.dest, spec.prefix)));
    if (res.code !== 0) return;
    const records = res.lines
      .filter((l) => l.stream === "stdout")
      .map((l) => l.line.trim())
      .filter(Boolean)
      .map((name) => ({ id: name, createdAt: parseBackupTimestamp(name) }))
      .filter((r): r is { id: string; createdAt: number } => r.createdAt !== null);
    const prune = selectBackupsToPrune(
      records,
      spec.keep,
      spec.retentionMs ?? 0,
      deps.now().getTime(),
    );
    for (const name of prune) {
      await deps
        .exec(deleteFileCommand(s3Remote(spec.dest, `${spec.prefix}/${name}`)))
        .catch(() => undefined);
    }
  } catch {
    // retention is best-effort
  }
}
