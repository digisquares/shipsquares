// Ring-buffer trim arithmetic (28-deployment-logs.md). Keep the newest `lineCap`
// rows per deployment via cheap seq-range arithmetic (no count(*)). Pure; the
// batched DELETE + log_truncated flip is the runtime caller.

export interface TrimDecision {
  /** delete rows with seq < this; null = nothing to trim. */
  deleteBelowSeq: number | null;
  /** whether a trim happened (caller flips deployments.log_truncated). */
  truncated: boolean;
}

export function computeTrim(
  maxSeq: number,
  currentRowCount: number,
  lineCap: number,
): TrimDecision {
  if (lineCap <= 0 || currentRowCount <= lineCap) {
    return { deleteBelowSeq: null, truncated: false };
  }
  // keep seq in [maxSeq - lineCap + 1, maxSeq] → exactly lineCap newest rows.
  return { deleteBelowSeq: maxSeq - lineCap + 1, truncated: true };
}
