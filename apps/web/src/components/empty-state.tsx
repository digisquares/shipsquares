import { type ReactNode } from "react";

// Branded, single-CTA empty state (25-design-system.md, principle 6: "every
// empty state has one clear CTA, never a dead end").
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden />
      <p className="empty-title">{title}</p>
      {description ? <p className="muted">{description}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}
