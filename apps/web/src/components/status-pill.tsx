import { isLiveStatus, statusLabel, statusTone, type Tone } from "../lib/status";

// Live status badge (25-design-system.md). Tone comes from the status by default
// (override `tone` where a word's meaning differs, e.g. a healthy "running"
// container). In-progress statuses get a subtle pulse (reduced-motion gated).
export function StatusPill({
  status,
  tone,
  label,
}: {
  status: string;
  tone?: Tone;
  label?: string;
}) {
  const t = tone ?? statusTone(status);
  const live = tone === undefined && isLiveStatus(status);
  const text = label ?? statusLabel(status);
  return (
    <span
      className={`pill pill-${t}${live ? " pill-live" : ""}`}
      data-status={status}
      aria-label={`Status: ${text}`}
    >
      {text}
    </span>
  );
}
