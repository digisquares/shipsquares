// Review-then-commit bar for pending row edits (database-studio/05). Appears
// while edits are pending; Commit applies the whole batch as one atomic
// transaction (POST /db-connections/:id/edits). Nothing is sent until then.
export function CommitBar({
  count,
  busy,
  onDiscard,
  onCommit,
}: {
  count: number;
  busy: boolean;
  onDiscard: () => void;
  onCommit: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="commit-bar" role="region" aria-label="Pending changes">
      <span className="commit-count">
        {count} pending change{count === 1 ? "" : "s"}
      </span>
      <span className="studio-spacer" />
      <button type="button" className="btn btn-ghost btn-sm" onClick={onDiscard} disabled={busy}>
        Discard
      </button>
      <button type="button" className="btn btn-primary btn-sm" onClick={onCommit} disabled={busy}>
        {busy ? "Committing…" : "Commit"}
      </button>
    </div>
  );
}
