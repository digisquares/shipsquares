import { test, expect } from "../fixtures/test";
import { openNewAppForm, seedSession } from "../utils/actions";
import { runId } from "../utils/run-id";

// DASHBOARD scenarios (docs/testing/04). Mocked mode. Persona: Olivia (owner),
// already signed in (we seed the mocked session before navigating).

test.describe("Dashboard", () => {
  test("DASH-1 — empty state invites the first app", async ({ appPage, state }) => {
    seedSession(state);
    await appPage.goto("/");
    await expect(appPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(appPage.getByText("No apps yet")).toBeVisible();
  });

  test("DASH-2 — app list shows the latest deployment status pill", async ({ appPage, state }) => {
    seedSession(state);
    state.apps = [{ id: "app_1", name: "api", branch: "main", repo: "https://x/y.git" }];
    state.deployments = {
      app_1: [
        {
          id: "dep_1",
          status: "succeeded",
          trigger: "manual",
          commitAfter: "abc1234",
          queuedAt: "2026-06-20T00:00:00Z",
        },
      ],
    };
    await appPage.goto("/");
    await expect(appPage.getByRole("link", { name: "api" })).toBeVisible();
    // StatusPill exposes data-status (no extra test-id needed).
    await expect(appPage.locator('[data-status="succeeded"]')).toBeVisible();
  });

  test("DASH-3 — Olivia creates an app and it appears in the list", async ({ appPage, state }) => {
    seedSession(state);
    const name = `hello-${runId()}`;
    await appPage.goto("/");
    const nameInput = await openNewAppForm(appPage);
    await nameInput.fill(name);
    await appPage.getByRole("button", { name: "Create", exact: true }).click();
    await expect(appPage.getByRole("link", { name })).toBeVisible();
    // The POST actually fired (not just an optimistic UI add).
    expect(state.calls.some((c) => c.method === "POST" && c.path === "/api/v1/apps")).toBe(true);
  });

  test("DASH-4 — an invalid app name blocks submission with inline feedback", async ({
    appPage,
    state,
  }) => {
    seedSession(state);
    await appPage.goto("/");
    const nameInput = await openNewAppForm(appPage);
    await nameInput.fill("Bad Name"); // space => invalid slug
    // Create stays disabled while the name is invalid; an inline error is shown.
    await expect(appPage.getByRole("button", { name: "Create", exact: true })).toBeDisabled();
    await expect(appPage.locator("#new-app-name-error")).toBeVisible();
    // …and no create request went out.
    expect(state.calls.some((c) => c.method === "POST" && c.path === "/api/v1/apps")).toBe(false);
  });

  test("DASH-4b — the slug suggestion fixes an invalid name", async ({ appPage, state }) => {
    seedSession(state);
    await appPage.goto("/");
    const nameInput = await openNewAppForm(appPage);
    await nameInput.fill("Bad Name");
    await appPage.getByRole("button", { name: /^use/ }).click(); // "use “bad-name”" (curly quotes)
    await expect(nameInput).toHaveValue("bad-name");
    await expect(appPage.getByRole("button", { name: "Create", exact: true })).toBeEnabled();
  });

  test("DASH-8 — Olivia adds a notification channel and tests it", async ({ appPage, state }) => {
    seedSession(state);
    await appPage.goto("/");
    const notif = appPage.locator(".card", {
      has: appPage.getByRole("heading", { name: "Notifications" }),
    });
    await expect(notif.getByText("No channels yet")).toBeVisible();
    await notif.locator(".card-head").getByRole("button", { name: "New channel" }).click();
    await notif.getByLabel("Channel name").fill("team-slack");
    await notif.getByLabel("Webhook URL").fill("https://hooks.slack.com/services/T/B/X");
    await notif.getByRole("button", { name: "Add" }).click();

    await expect(notif.getByText("team-slack")).toBeVisible();
    await notif.getByRole("button", { name: "Test" }).click();
    await expect(notif.getByText("Test delivered ✓")).toBeVisible();
  });

  test("DASH-9 — the Deploy button is disabled for an app with no source", async ({
    appPage,
    state,
  }) => {
    seedSession(state);
    state.apps = [{ id: "app_src", name: "no-source", branch: "main", repo: null, image: null }];
    await appPage.goto("/");
    const row = appPage.locator("li.app-row", { hasText: "no-source" });
    await expect(row.getByRole("button", { name: "Deploy" })).toBeDisabled();
  });
});
