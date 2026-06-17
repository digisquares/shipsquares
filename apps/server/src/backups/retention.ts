// Backup retention (27-db-backup-replication.md). Keep at least the newest
// `keepCount` backups AND anything inside the retention window; prune the rest.
// Pure; the actual object-store/SFTP delete is the runtime caller.

export interface BackupRecord {
  id: string;
  createdAt: number; // epoch ms
}

export function selectBackupsToPrune(
  backups: BackupRecord[],
  keepCount: number,
  retentionMs: number,
  now: number,
): string[] {
  const sorted = [...backups].sort((a, b) => b.createdAt - a.createdAt);
  const keep = new Set(sorted.slice(0, Math.max(0, keepCount)).map((b) => b.id));
  for (const b of sorted) {
    if (now - b.createdAt <= retentionMs) keep.add(b.id);
  }
  return sorted.filter((b) => !keep.has(b.id)).map((b) => b.id);
}
