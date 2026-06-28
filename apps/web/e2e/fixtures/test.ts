import { test as base, type Page } from "@playwright/test";

import {
  defaultState,
  FULL,
  installMockApi,
  type MockState,
  type MockUser,
  ownerUser,
} from "./mock-api";

// E2E fixtures. See docs/testing/02-playwright-setup.md.
//
// Two stack modes (PLAYWRIGHT_STACK):
//  - "mocked" (default): a deterministic in-page mock control plane intercepts
//    /auth/*, /sso-providers and /api/v1/* (see mock-api.ts). SPA assets pass
//    through `vite preview`. Good for UI logic, routing, validation, RBAC error
//    rendering, and scripted status flows.
//  - "full": real control plane reached via E2E_BASE_URL; no interception. Real
//    deploys/logs/WS. Needs a seeded owner (MCL-1) — see seed.ts.
export { FULL };
export type { MockState, MockUser };
export { defaultState, ownerUser };

export const test = base.extend<{
  /** Mutable mock control-plane state. Seed it before navigating. */
  state: MockState;
  /** A page with the mock control plane installed (logged out by default). */
  appPage: Page;
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures require the destructure arg
  state: async ({}, use) => {
    await use(defaultState());
  },
  appPage: async ({ page, state }, use) => {
    await installMockApi(page, state);
    await use(page);
  },
});

export { expect } from "@playwright/test";
