import type { S3Destination } from "./commands.js";
import {
  createSlotCommandHost,
  currentLsnCommandHost,
  mkSpoolCommand,
  parseLsn,
  walDrainCommandHost,
  walSyncCommand,
  type PgHostTarget,
} from "./pitr.js";

// WAL-archive run orchestration (27-db-backup-replication.md): one scheduled
// "drain to now" — ensure the slot (idempotent), read the server's current LSN,
// receive WAL up to it into a local spool, then move the completed segments to
// S3. Exec is injected so the engine is unit-tested; the service binds
// runCommand (local) + the sealed admin creds. Best-effort: never throws.

export interface ExecResult {
  code: number;
  timedOut?: boolean;
  lines: { stream: string; line: string }[];
}

export interface WalArchiveSpec {
  target: PgHostTarget;
  slot: string;
  spoolDir: string;
  dest: S3Destination;
  walPrefix: string;
}

export interface WalArchiveDeps {
  exec: (command: string) => Promise<ExecResult>;
}

export interface WalArchiveResult {
  ok: boolean;
  lsn?: string;
  error?: string;
}

const stdoutOf = (r: ExecResult): string =>
  r.lines
    .filter((l) => l.stream === "stdout")
    .map((l) => l.line)
    .join("\n");

const errTail = (r: ExecResult): string =>
  r.lines
    .filter((l) => l.stream === "stderr")
    .slice(-5)
    .map((l) => l.line)
    .join("\n");

export async function runWalArchive(
  spec: WalArchiveSpec,
  deps: WalArchiveDeps,
): Promise<WalArchiveResult> {
  try {
    await deps.exec(mkSpoolCommand(spec.spoolDir));

    const slot = await deps.exec(createSlotCommandHost(spec.target, spec.slot));
    if (slot.code !== 0) return { ok: false, error: `slot create failed: ${errTail(slot)}` };

    const lsnRes = await deps.exec(currentLsnCommandHost(spec.target));
    const lsn = lsnRes.code === 0 ? parseLsn(stdoutOf(lsnRes)) : null;
    if (!lsn) return { ok: false, error: `could not read current LSN: ${errTail(lsnRes)}` };

    // pg_receivewal --endpos exits 0 once it reaches the LSN; a non-zero exit is
    // a real stream failure (auth, wal_level=minimal, slot gone).
    const drain = await deps.exec(walDrainCommandHost(spec.target, spec.spoolDir, spec.slot, lsn));
    if (drain.code !== 0) return { ok: false, lsn, error: `wal drain failed: ${errTail(drain)}` };

    const sync = await deps.exec(walSyncCommand(spec.spoolDir, spec.dest, spec.walPrefix));
    if (sync.code !== 0) return { ok: false, lsn, error: `wal upload failed: ${errTail(sync)}` };

    return { ok: true, lsn };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
