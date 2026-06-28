import { test, expect } from "../fixtures/test";
import { seedSession } from "../utils/actions";

// INVITE (#/invite?token=…) and device LOGIN-FLOW (#/login-flow?redirect=…)
// scenarios (docs/testing/04). Both self-gate on the session.

test.describe("Invite accept", () => {
  test("INV-1 — a logged-in user accepts a valid invite", async ({ appPage, state }) => {
    seedSession(state);
    await appPage.goto("/#/invite?token=tok_valid");
    await expect(appPage.getByRole("heading", { name: "Organization invite" })).toBeVisible();
    // Success message renders before the 1.2s redirect home.
    await expect(appPage.getByText("You've joined as deployer. Taking you in…")).toBeVisible();
  });

  test("INV-2 — accepting while logged out shows the login screen first", async ({ appPage }) => {
    // No session seeded.
    await appPage.goto("/#/invite?token=tok_valid");
    await expect(appPage.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("INV-3 — an expired invite explains itself", async ({ appPage, state }) => {
    seedSession(state);
    state.fail = { "POST /invites/accept": { status: 410 } };
    await appPage.goto("/#/invite?token=tok_expired");
    await expect(appPage.getByText("This invite has expired — ask for a new one.")).toBeVisible();
    await expect(appPage.getByRole("link", { name: "Go to dashboard" })).toBeVisible();
  });

  test("INV-3b — a wrong-email invite explains itself", async ({ appPage, state }) => {
    seedSession(state);
    state.fail = { "POST /invites/accept": { status: 403 } };
    await appPage.goto("/#/invite?token=tok_wrong");
    await expect(
      appPage.getByText("This invite was sent to a different email address."),
    ).toBeVisible();
  });
});

test.describe("Device login-flow", () => {
  test("AUTH-7 — a valid device redirect shows the authorize consent", async ({
    appPage,
    state,
  }) => {
    seedSession(state);
    await appPage.goto("/#/login-flow?redirect=" + encodeURIComponent("ss://login"));
    await expect(appPage.getByRole("heading", { name: "Authorize device" })).toBeVisible();
    await expect(appPage.getByText(/as owner@local\.test/)).toBeVisible();
    await expect(appPage.getByRole("button", { name: "Authorize this device" })).toBeEnabled();
    await expect(appPage.getByRole("alert")).toHaveCount(0); // not the invalid-redirect state
  });

  test("AUTH-7b — authorizing mints a device token (POST fires)", async ({ appPage, state }) => {
    seedSession(state);
    await appPage.goto("/#/login-flow?redirect=" + encodeURIComponent("ss://login"));
    // The handler POSTs, then hands the token to the ss:// deep link (a no-op
    // navigation in the test browser) — we assert the mint request happened.
    await appPage.getByRole("button", { name: "Authorize this device" }).click();
    await expect
      .poll(() =>
        state.calls.some((c) => c.method === "POST" && c.path === "/api/v1/login/flow/authorize"),
      )
      .toBe(true);
  });

  test("AUTH-8 — an unexpected redirect target is refused", async ({ appPage, state }) => {
    seedSession(state);
    await appPage.goto("/#/login-flow?redirect=" + encodeURIComponent("https://evil.example.com"));
    await expect(appPage.getByRole("alert")).toContainText(
      "This login link is invalid or has an unexpected return target",
    );
    await expect(appPage.getByRole("button", { name: "Authorize this device" })).toHaveCount(0);
  });
});
