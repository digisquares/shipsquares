import { useEffect, useRef, useSyncExternalStore } from "react";

import { getRequest, resolveConfirm, subscribe } from "../lib/confirm";

// Single host for the imperative confirm() API (25-design-system.md). Accessible
// alertdialog: initial focus lands on Cancel for destructive prompts (safer),
// Esc and backdrop-click cancel. Entrance animation is reduced-motion gated.
export function ConfirmDialog() {
  const req = useSyncExternalStore(subscribe, getRequest, getRequest);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (req) (req.danger ? cancelRef : confirmRef).current?.focus();
  }, [req]);

  if (!req) return null;
  return (
    <div className="cmdk-overlay" role="presentation" onMouseDown={() => resolveConfirm(false)}>
      <div
        className="confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={req.message ? "confirm-msg" : undefined}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") resolveConfirm(false);
        }}
      >
        <h2 id="confirm-title" className="confirm-title">
          {req.title}
        </h2>
        {req.message ? (
          <p id="confirm-msg" className="confirm-msg muted">
            {req.message}
          </p>
        ) : null}
        <div className="confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-ghost"
            onClick={() => resolveConfirm(false)}
          >
            {req.cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`btn ${req.danger ? "btn-danger" : "btn-primary"}`}
            onClick={() => resolveConfirm(true)}
          >
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
