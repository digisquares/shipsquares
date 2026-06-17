import { nextOnboardingStep, type OnboardingState, onboardingSteps } from "../lib/onboarding";

// First-run guided checklist (25-design-system.md, flow 1). Shows on the
// dashboard until every step is done; the active step is highlighted and the
// first step offers a direct CTA.
export function Onboarding({
  state,
  onCreateApp,
}: {
  state: OnboardingState;
  onCreateApp: () => void;
}) {
  const steps = onboardingSteps(state);
  const next = nextOnboardingStep(state);
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section className="card onboarding">
      <div className="card-head">
        <h2>Get started</h2>
        <span className="muted">
          {doneCount} of {steps.length}
        </span>
      </div>
      <p className="muted">Connect a repo, deploy, and go live in a couple of minutes.</p>
      <ol className="onboarding-steps">
        {steps.map((s) => {
          const active = next?.id === s.id;
          return (
            <li
              key={s.id}
              className={`onboarding-step${s.done ? " done" : ""}${active ? " active" : ""}`}
              aria-current={active ? "step" : undefined}
            >
              <span className="onboarding-check" aria-hidden>
                {s.done ? "✓" : ""}
              </span>
              <span className="onboarding-step-title">{s.title}</span>
              {active && s.id === "create" ? (
                <button className="btn btn-primary btn-sm" onClick={onCreateApp}>
                  Create app
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
