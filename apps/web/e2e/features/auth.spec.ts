import { test, expect } from "../fixtures/test";
import { seedSession } from "../utils/actions";

// AUTH scenarios (docs/testing/04-scenario-catalog.md). Runnable in mocked mode.
// Persona: a user signing into ShipSquares.

test.describe("Auth", () => {
  test("AUTH-1 — Olivia signs in with valid credentials and reaches the dashboard", async ({
    appPage,
  }) => {
    await appPage.goto("/");
    await expect(appPage.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await appPage.getByLabel("Email").fill("owner@local.test");
    await appPage.getByLabel("Password").fill("correct-horse"); // the mock's accepted password
    await appPage.getByRole("button", { name: "Sign in" }).click();

    // Sign-in flips the mocked session; the app reloads and the gate renders the app.
    await expect(appPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(appPage.getByRole("heading", { name: "Sign in" })).toBeHidden();
  });

  test("AUTH-2 — wrong password shows an error and keeps the user out", async ({ appPage }) => {
    await appPage.goto("/");
    await appPage.getByLabel("Email").fill("owner@local.test");
    await appPage.getByLabel("Password").fill("nope");
    await appPage.getByRole("button", { name: "Sign in" }).click();

    await expect(appPage.getByRole("alert")).toContainText(/invalid email or password/i);
    await expect(appPage.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("AUTH-3 — configured SSO providers render a 'Continue with' button", async ({
    appPage,
    state,
  }) => {
    state.ssoProviders = ["github"]; // route handlers read `state` live, so set before navigating
    await appPage.goto("/");
    await expect(appPage.getByRole("button", { name: /continue with github/i })).toBeVisible();
  });

  // AUTH-4/5 (2FA at login) can't run in mocked mode: better-auth's client owns
  // the sign-in→TOTP transition and does not surface `twoFactorRedirect` to the
  // app from a route-mocked response (verified — the client falls through to a
  // normal session reload). Needs the full stack with a real enrolled secret, or
  // a deterministic client seam. Tracked for the full-stack project. See MCL.
  test.fixme("AUTH-4 — a 2FA-enrolled user is prompted for a TOTP code, then reaches the dashboard (full-stack)", async ({
    appPage,
    state,
  }) => {
    state.twoFactorOnSignIn = true;
    await appPage.goto("/");
    await appPage.getByLabel("Email").fill("owner@local.test");
    await appPage.getByLabel("Password").fill("correct-horse");
    await appPage.getByRole("button", { name: "Sign in" }).click();
    await expect(appPage.getByRole("heading", { name: "Two-factor code" })).toBeVisible();
    await appPage.getByPlaceholder("123456").fill("123456");
    await appPage.getByRole("button", { name: "Verify" }).click();
    await expect(appPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test.fixme("AUTH-5 — an invalid TOTP code keeps the user gated (full-stack)", async ({
    appPage,
    state,
  }) => {
    state.twoFactorOnSignIn = true;
    await appPage.goto("/");
    await appPage.getByLabel("Email").fill("owner@local.test");
    await appPage.getByLabel("Password").fill("correct-horse");
    await appPage.getByRole("button", { name: "Sign in" }).click();
    await expect(appPage.getByRole("heading", { name: "Two-factor code" })).toBeVisible();
    await appPage.getByPlaceholder("123456").fill("000000");
    await appPage.getByRole("button", { name: "Verify" }).click();
    await expect(appPage.getByRole("alert")).toBeVisible();
  });

  test("AUTH-6 — sign out returns to the login screen", async ({ appPage, state }) => {
    seedSession(state);
    await appPage.goto("/");
    await expect(appPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await appPage.getByRole("button", { name: "Account menu" }).click();
    await appPage.getByRole("menuitem", { name: "Sign out" }).click();

    await expect(appPage.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("PERSIST-1 — a seeded session survives a reload (stays logged in)", async ({
    appPage,
    state,
  }) => {
    seedSession(state);
    await appPage.goto("/");
    await expect(appPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await appPage.reload();
    await expect(appPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });
});
