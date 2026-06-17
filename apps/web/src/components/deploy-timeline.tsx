import { type ApiStep, deployTimeline, stepsTimeline } from "../lib/deploy-timeline";

// Horizontal deploy stepper (25-design-system.md): the REAL recorded pipeline
// steps (fetch → build → up → health …, with durations) when the steps API has
// them, falling back to the coarse status lifecycle. The in-progress dot
// pulses (reduced-motion gated in CSS); done segments fill green.
export function DeployTimeline({ status, steps = [] }: { status: string; steps?: ApiStep[] }) {
  const phases = stepsTimeline(steps) ?? deployTimeline(status);
  return (
    <ol className="dtl" aria-label="Deploy progress">
      {phases.map((p, i) => (
        <li key={p.id} className={`dtl-phase dtl-${p.state}`}>
          <span className="dtl-dot" aria-hidden>
            {p.state === "done" ? "✓" : p.state === "failed" ? "✕" : ""}
          </span>
          <span className="dtl-label">
            {p.label}
            {p.duration ? <span className="dtl-duration"> {p.duration}</span> : null}
          </span>
          {/* the connector lives inside the li — a span may not be an <ol> child */}
          {i < phases.length - 1 ? (
            <span className={`dtl-bar${p.state === "done" ? " filled" : ""}`} aria-hidden />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
