// Backup/restore command composition (27-db-backup-replication.md), adapted
// from Dokploy's utils/backups (Apache-2.0, see NOTICE + 35-reuse-map.md):
// per-engine dumps piped to gzip, rclone inline-S3 remotes for
// upload/size/list/delete. Pure string builders — every user-influenced value
// is single-quote-escaped; the runtime runner (docker exec local/remote)
// consumes these as shell pipelines.

export type BackupEngine = "postgres" | "mysql" | "mariadb";

export interface DumpTarget {
  engine: BackupEngine;
  container: string;
  user: string;
  password?: string;
  database: string;
}

export interface S3Destination {
  provider: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  endpoint?: string;
  bucket: string;
}

/** POSIX single-quote escaping: ' → '\'' (everything else is literal). */
export function shq(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function dumpCommand(t: DumpTarget): string {
  if (t.engine === "postgres") {
    return `docker exec ${shq(t.container)} pg_dump -Fc --no-acl --no-owner -U ${shq(t.user)} ${shq(t.database)} | gzip`;
  }
  const tool = t.engine === "mariadb" ? "mariadb-dump" : "mysqldump";
  return `docker exec ${shq(t.container)} ${tool} --single-transaction -u ${shq(t.user)} -p${shq(t.password ?? "")} ${shq(t.database)} | gzip`;
}

export interface HostDumpTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** pg_dump against a host-reachable Postgres (the 24 managed server — not a
 *  container). The password rides an env assignment, never argv. */
export function dumpCommandHost(t: HostDumpTarget): string {
  return (
    `PGPASSWORD=${shq(t.password)} pg_dump -Fc --no-acl --no-owner ` +
    `-h ${shq(t.host)} -p ${t.port} -U ${shq(t.user)} ${shq(t.database)} | gzip`
  );
}

/** Restore into the managed HOST Postgres (24) — password via env, never argv. */
export function restorePipelineHost(remote: string, t: HostDumpTarget): string {
  return (
    `rclone cat ${shq(remote)} | gunzip -c | ` +
    `PGPASSWORD=${shq(t.password)} pg_restore --clean --if-exists ` +
    `-h ${shq(t.host)} -p ${t.port} -U ${shq(t.user)} -d ${shq(t.database)}`
  );
}

export function restorePipeline(remote: string, t: DumpTarget): string {
  const restore =
    t.engine === "postgres"
      ? `docker exec -i ${shq(t.container)} pg_restore --clean --if-exists -U ${shq(t.user)} -d ${shq(t.database)}`
      : `docker exec -i ${shq(t.container)} ${t.engine === "mariadb" ? "mariadb" : "mysql"} -u ${shq(t.user)} -p${shq(t.password ?? "")} ${shq(t.database)}`;
  return `rclone cat ${shq(remote)} | gunzip -c | ${restore}`;
}

/** rclone inline remote (":s3,key=value,…:bucket/path"); values with commas,
 *  spaces, or quotes are double-quoted per rclone's connection-string rules. */
export function s3Remote(dest: S3Destination, path: string): string {
  // Quote values with a comma/space/quote OR a colon — an endpoint URL's
  // `http://host:port` colon would otherwise be read as the path separator.
  const quote = (v: string): string => (/[,\s":]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  const params = [
    ["provider", dest.provider],
    ["access_key_id", dest.accessKeyId],
    ["secret_access_key", dest.secretAccessKey],
    ["region", dest.region ?? ""],
    ["endpoint", dest.endpoint ?? ""],
  ]
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${quote(v!)}`)
    .join(",");
  return `:s3,${params}:${dest.bucket}/${path}`;
}

export function uploadPipeline(dump: string, remote: string): string {
  return `${dump} | rclone rcat ${shq(remote)}`;
}

/** Size of one remote object as JSON ({"count":1,"bytes":N}). */
export function sizeCommand(remote: string): string {
  return `rclone size ${shq(remote)} --json`;
}

export function listFilesCommand(remoteDir: string): string {
  return `rclone lsf ${shq(remoteDir)} --files-only`;
}

export function deleteFileCommand(remote: string): string {
  return `rclone deletefile ${shq(remote)}`;
}

/** Sortable, filesystem-safe name: <db>-YYYY-MM-DDTHH-MM-SS.<ext> (default
 *  dump.gz for logical dumps; physical base backups pass "tar.gz"). */
export function backupFilename(database: string, at: Date, ext = "dump.gz"): string {
  const stamp = at.toISOString().slice(0, 19).replaceAll(":", "-");
  return `${database}-${stamp}.${ext}`;
}

/** Inverse of backupFilename: epoch ms from the embedded UTC stamp, null for
 *  anything else — foreign files in the prefix must never be pruned. Matches
 *  .dump.gz (logical), .tar.gz, and .tar (physical base bundle) artifacts. */
export function parseBackupTimestamp(filename: string): number | null {
  const m = /^.+-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})\.(?:dump\.gz|tar\.gz|tar)$/.exec(
    filename,
  );
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
  return Number.isNaN(ms) ? null : ms;
}
