// First-run onboarding checklist (25-design-system.md, flow 1: "connect → first
// deploy in under two minutes; a guided, skimmable checklist"). Pure + tested;
// the dashboard derives the state from its apps/deploys and renders <Onboarding>.

export interface OnboardingState {
  /** at least one app exists */
  hasApp: boolean;
  /** at least one app has a repo or image (i.e. is deployable) */
  hasDeployable: boolean;
  /** at least one deployment has been triggered (any status) */
  hasDeploy: boolean;
  /** at least one deployment succeeded */
  hasSuccess: boolean;
}

export type OnboardingStepId = "create" | "connect" | "deploy" | "live";

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  done: boolean;
}

export function onboardingSteps(s: OnboardingState): OnboardingStep[] {
  return [
    { id: "create", title: "Create your first app", done: s.hasApp },
    { id: "connect", title: "Connect a Git repo or image", done: s.hasDeployable },
    { id: "deploy", title: "Trigger a deploy", done: s.hasDeploy },
    { id: "live", title: "See it live", done: s.hasSuccess },
  ];
}

export function onboardingComplete(s: OnboardingState): boolean {
  return onboardingSteps(s).every((step) => step.done);
}

/** The first not-yet-done step (the one to nudge), or null when complete. */
export function nextOnboardingStep(s: OnboardingState): OnboardingStep | null {
  return onboardingSteps(s).find((step) => !step.done) ?? null;
}
