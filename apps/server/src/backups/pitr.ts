import { s3Remote, shq, type S3Destination } from "./commands.js";

// Point-in-time recovery command composition (27-db-backup-replication.md):
// physical base backups (pg_basebackup) + WAL archiving (a physical replication
// slot drained with pg_receivewal --endpos) to S3 via rclone, plus the restore
// runbook composers. Pure string builders — every user-influenced value is
// single-quote-escaped (shq) for the shell and SQL string literals are doubled
// (pgLit); secrets ride PGPASSWORD env, never argv. The runtime runner consumes
// these through the injected exec, exactly like the logical-dump pipeline.

export interface PgHostTarget {
  host: string;
  port: number;
  user: string;
  password: string;
}

/** SQL string literal: ' → '' (for slot names embedded in psql -c). */
export function pgLit(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const pgEnv = (t: PgHostTarget): string => `PGPASSWORD=${shq(t.password)}`;
const conn = (t: PgHostTarget): string => `-h ${shq(t.host)} -p ${t.port} -U ${shq(t.user)} -w`;

/** Physical base backup of the whole cluster to a local staging DIR (one tar per
 *  tablespace — required for multi-tablespace clusters, which `-D -` cannot
 *  stream), then bundle the dir into a single tar on stdout. The runner appends
 *  `| rclone rcat`; the service removes the staging after upload. `-X fetch`
 *  folds in the WAL needed for a consistent base. Needs a REPLICATION role. */
export function baseBackupCommandHost(t: PgHostTarget, stagingDir: string): string {
  const s = shq(stagingDir);
  return (
    `rm -rf ${s} && mkdir -p ${s} && ` +
    `${pgEnv(t)} pg_basebackup ${conn(t)} -D ${s} -F t -X fetch -z && ` +
    `tar -c -C ${s} .`
  );
}

/** Create the physical slot if absent (reserves WAL immediately so no segment
 *  is recycled before it is archived). Idempotent. */
export function createSlotCommandHost(t: PgHostTarget, slot: string): string {
  const sql =
    `SELECT pg_create_physical_replication_slot(${pgLit(slot)}, true) ` +
    `WHERE NOT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = ${pgLit(slot)})`;
  return `${pgEnv(t)} psql ${conn(t)} -d postgres -v ON_ERROR_STOP=1 -tAc ${shq(sql)}`;
}

/** Drop the slot if present (teardown — frees the retained WAL). */
export function dropSlotCommandHost(t: PgHostTarget, slot: string): string {
  const sql =
    `SELECT pg_drop_replication_slot(${pgLit(slot)}) ` +
    `WHERE EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = ${pgLit(slot)})`;
  return `${pgEnv(t)} psql ${conn(t)} -d postgres -tAc ${shq(sql)}`;
}

/** The server's current WAL write position — the endpos each drain catches up to. */
export function currentLsnCommandHost(t: PgHostTarget): string {
  return `${pgEnv(t)} psql ${conn(t)} -d postgres -tAc ${shq("SELECT pg_current_wal_lsn()")}`;
}

/** Drain WAL from the slot up to endposLsn into spoolDir (compressed), then exit
 *  (--no-loop). The slot resumes from here on the next run, so there is no gap. */
export function walDrainCommandHost(
  t: PgHostTarget,
  spoolDir: string,
  slot: string,
  endposLsn: string,
): string {
  return (
    `${pgEnv(t)} pg_receivewal ${conn(t)} --slot=${shq(slot)} ` +
    `--no-loop --compress=5 --endpos=${shq(endposLsn)} -D ${shq(spoolDir)}`
  );
}

/** Upload completed WAL to S3 and delete it locally: the `.gz` segments AND the
 *  plain `.history` timeline files (needed to follow a timeline switch on
 *  restore). The in-progress `*.partial` stays in the spool for the next drain. */
export function walSyncCommand(spoolDir: string, dest: S3Destination, walPrefix: string): string {
  return (
    `rclone move ${shq(spoolDir)} ${shq(s3Remote(dest, walPrefix))} ` +
    `--include ${shq("*.gz")} --include ${shq("*.history")} --no-traverse`
  );
}

export function mkSpoolCommand(spoolDir: string): string {
  return `mkdir -p ${shq(spoolDir)}`;
}

/** A PG LSN is two hex words joined by a slash (e.g. "0/3000060"). Parse the
 *  single value psql -tAc prints; null for anything unexpected. */
export function parseLsn(stdout: string): string | null {
  const v = stdout.trim().split(/\s+/)[0] ?? "";
  return /^[0-9A-Fa-f]+\/[0-9A-Fa-f]+$/.test(v) ? v : null;
}

// ── restore (operator runbook) ───────────────────────────────────────────────

/** Manual-runbook base extract: pull just the main data tar (`base.tar.gz`) out
 *  of the bundle and lay it into the data directory. Single-tablespace — a
 *  multi-tablespace cluster needs the automated restore (`restoreBundleCommand`). */
export function restoreBaseCommand(
  dest: S3Destination,
  baseLocation: string,
  dataDir: string,
): string {
  return (
    `rclone cat ${shq(s3Remote(dest, baseLocation))} | ` +
    `tar -xO --wildcards '*base.tar.gz' | tar -xz -C ${shq(dataDir)}`
  );
}

/** Automated-restore base extract: unpack the bundle, lay the main data tar into
 *  the data dir, extract each tablespace tar (`<oid>.tar.gz`) to <tbsDir>/<oid>,
 *  and rewrite `tablespace_map` so each oid points at the in-container `/tbs/<oid>`
 *  mount — postgres recreates the pg_tblspc symlinks from that map at recovery.
 *  Single-tablespace clusters carry only base.tar.gz (no map), so it's a no-op. */
export function restoreBundleCommand(
  dest: S3Destination,
  baseLocation: string,
  dataDir: string,
  unpackDir: string,
  tbsDir: string,
): string {
  const remote = shq(s3Remote(dest, baseLocation));
  const u = shq(unpackDir);
  const d = shq(dataDir);
  const tb = shq(tbsDir);
  return (
    `mkdir -p ${u} ${tb} && rclone cat ${remote} | tar -x -C ${u} && ` +
    `tar -xz -C ${d} -f ${u}/base.tar.gz && ` +
    `for f in ${u}/*.tar.gz; do b=$(basename "$f" .tar.gz); ` +
    `[ "$b" = base ] && continue; mkdir -p ${tb}/"$b" && tar -xz -C ${tb}/"$b" -f "$f"; done && ` +
    `{ [ -f ${d}/tablespace_map ] && sed -E 's#^([0-9]+) .*#\\1 /tbs/\\1#' -i ${d}/tablespace_map || true; }`
  );
}

/** postgresql.auto.conf recovery settings for PITR replay. The WAL remote embeds
 *  the S3 credential (the restore target is operator-managed) — see the runbook
 *  note in db-pitr.md. With a targetTime PG replays to it and promotes; without,
 *  it recovers to the end of the archived WAL. */
export function recoveryConfig(
  dest: S3Destination,
  walPrefix: string,
  targetTime?: string,
): string {
  const walRemote = s3Remote(dest, walPrefix);
  const lines = [`restore_command = 'rclone cat ${walRemote}/%f.gz | gunzip -c > %p'`];
  if (targetTime) {
    lines.push(`recovery_target_time = '${targetTime}'`, `recovery_target_action = 'promote'`);
  }
  return `${lines.join("\n")}\n`;
}

export interface RestoreStep {
  title: string;
  command: string;
}

/** The ordered restore runbook: stop → wipe → extract base → write recovery
 *  config + signal → start (PG replays WAL to the target, then promotes). Pure;
 *  the route returns it for an operator (automated one-click restore into a
 *  fresh cluster is a later sub-slice). */
export function restorePlanSteps(args: {
  dest: S3Destination;
  baseLocation: string;
  walPrefix: string;
  dataDir: string;
  targetTime?: string;
}): RestoreStep[] {
  const { dest, baseLocation, walPrefix, dataDir, targetTime } = args;
  const d = shq(dataDir);
  return [
    { title: "Stop the target PostgreSQL", command: `pg_ctl -D ${d} stop -m fast` },
    { title: "Empty the target data directory", command: `rm -rf ${d}/* ${d}/.??*` },
    {
      title: "Restore the physical base backup",
      command: restoreBaseCommand(dest, baseLocation, dataDir),
    },
    {
      title: "Write recovery settings",
      command: `cat >> ${d}/postgresql.auto.conf <<'EOF'\n${recoveryConfig(dest, walPrefix, targetTime)}EOF`,
    },
    { title: "Signal recovery mode", command: `touch ${d}/recovery.signal` },
    {
      title: "Start PostgreSQL (replays WAL to the target, then promotes)",
      command: `pg_ctl -D ${d} start`,
    },
  ];
}

// ── automated restore into a fresh container (orchestrated by the service) ────

/** Download the archived WAL (compressed segments + plain `.history` timeline
 *  files) into a local dir that gets mounted read-only into the restore
 *  container at /wal. */
export function stageWalCommand(dest: S3Destination, walPrefix: string, walDir: string): string {
  return (
    `rclone copy ${shq(s3Remote(dest, walPrefix))} ${shq(walDir)} ` +
    `--include ${shq("*.gz")} --include ${shq("*.history")}`
  );
}

/** postgresql.auto.conf recovery settings for the restore CONTAINER: WAL comes
 *  from the mounted /wal (gz segments, falling back to a plain copy for the
 *  uncompressed `.history` files). With a targetTime PG promotes at it; without,
 *  it recovers to the end of the staged WAL and promotes. */
export function containerRecoveryConfig(targetTime?: string): string {
  const lines = [`restore_command = 'gunzip -c /wal/%f.gz > %p 2>/dev/null || cp /wal/%f %p'`];
  if (targetTime) {
    lines.push(`recovery_target_time = '${targetTime}'`, `recovery_target_action = 'promote'`);
  }
  return `${lines.join("\n")}\n`;
}

/** Hand a staged dir to the postgres image's uid (999) via a throwaway root
 *  container (no host sudo — the control plane already drives Docker). */
export function chownDirCommand(dir: string): string {
  return `docker run --rm -v ${shq(dir)}:/d alpine chown -R 999:999 /d`;
}

/** Start the restore postgres on a fresh loopback port: data dir + read-only WAL
 *  archive + the tablespace tree (/tbs, where pg_tblspc symlinks point) mounted.
 *  The data dir is pre-initialised, so the image skips initdb and enters archive
 *  recovery (recovery.signal). */
export function restoreContainerRunCommand(
  name: string,
  dataDir: string,
  walDir: string,
  tbsDir: string,
  port: number,
  image: string,
): string {
  return (
    `docker run -d --name ${shq(name)} ` +
    `-v ${shq(dataDir)}:/var/lib/postgresql/data -v ${shq(walDir)}:/wal:ro ` +
    `-v ${shq(tbsDir)}:/tbs -p 127.0.0.1:${port}:5432 ${shq(image)}`
  );
}

/** Probe recovery state inside the restore container; "f" once promoted. */
export function pgIsInRecoveryCommand(name: string): string {
  return `docker exec ${shq(name)} psql -U postgres -tAc ${shq("SELECT pg_is_in_recovery()")}`;
}

/** PG_VERSION holds just the major version (e.g. "16"); the restore image must
 *  match it. null for anything unexpected. */
export function parsePgVersion(content: string): string | null {
  const v = content.trim();
  return /^\d{1,2}$/.test(v) ? v : null;
}
