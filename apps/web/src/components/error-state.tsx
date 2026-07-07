// Failed-load state (docs/platform-review/03-ui-ux.md §1) — the counterpart to
// EmptyState. A load error must read as an error with a Retry, never as "No X
// yet". `role="alert"` so assistive tech announces the failure; mirrors the
// `.empty` layout with a fail-tone mark.
export function ErrorState({
  title = "Couldn't load this",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <div className="error-state-mark" aria-hidden />
      <p className="error-state-title">{title}</p>
      {message ? <p className="muted">{message}</p> : null}
      {onRetry ? (
        <div className="error-state-action">
          <button className="btn btn-sm" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
