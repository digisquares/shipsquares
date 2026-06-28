import { defineConfig, devices } from "@playwright/test";

// Browser E2E for the ShipSquares dashboard. See docs/testing/02-playwright-setup.md.
// Two modes via PLAYWRIGHT_STACK:
//   (unset) "mocked" — built SPA + Playwright network routing (no backend, fast, CI-on-PR)
//   "full"          — real control plane (pnpm dev / VM); E2E_BASE_URL points at it
const full = process.env.PLAYWRIGHT_STACK === "full";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }], ["list"], ["junit", { outputFile: "e2e-results.xml" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4173",
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // In mocked mode we serve the built SPA via `vite preview`; in full mode the
  // stack is started out-of-band (pnpm dev / VM) and reached via E2E_BASE_URL.
  webServer: full
    ? undefined
    : {
        command: "pnpm run build && pnpm run preview -- --port 4173",
        url: "http://localhost:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // P3 (docs/testing/06): firefox, webkit, and mobile viewports.
  ],
});
