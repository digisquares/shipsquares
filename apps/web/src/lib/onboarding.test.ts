import { describe, expect, it } from "vitest";

import {
  nextOnboardingStep,
  onboardingComplete,
  onboardingSteps,
  type OnboardingState,
} from "./onboarding";

const STATE = (over: Partial<OnboardingState> = {}): OnboardingState => ({
  hasApp: false,
  hasDeployable: false,
  hasDeploy: false,
  hasSuccess: false,
  ...over,
});

describe("onboarding", () => {
  it("starts with four undone steps and nudges 'create' first", () => {
    const s = STATE();
    const steps = onboardingSteps(s);
    expect(steps).toHaveLength(4);
    expect(steps.every((x) => !x.done)).toBe(true);
    expect(onboardingComplete(s)).toBe(false);
    expect(nextOnboardingStep(s)?.id).toBe("create");
  });

  it("advances the nudge as state progresses", () => {
    expect(nextOnboardingStep(STATE({ hasApp: true }))?.id).toBe("connect");
    expect(nextOnboardingStep(STATE({ hasApp: true, hasDeployable: true }))?.id).toBe("deploy");
    expect(
      nextOnboardingStep(STATE({ hasApp: true, hasDeployable: true, hasDeploy: true }))?.id,
    ).toBe("live");
  });

  it("is complete only when every step is done", () => {
    const done = STATE({ hasApp: true, hasDeployable: true, hasDeploy: true, hasSuccess: true });
    expect(onboardingComplete(done)).toBe(true);
    expect(nextOnboardingStep(done)).toBeNull();
  });

  it("marks the matching steps done", () => {
    const steps = onboardingSteps(STATE({ hasApp: true, hasSuccess: true }));
    expect(steps.find((x) => x.id === "create")?.done).toBe(true);
    expect(steps.find((x) => x.id === "live")?.done).toBe(true);
    expect(steps.find((x) => x.id === "connect")?.done).toBe(false);
  });
});
