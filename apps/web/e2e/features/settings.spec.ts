import { test, expect, type MockState } from "../fixtures/test";
import { seedSession } from "../utils/actions";

// SETTINGS scenarios (docs/testing/04). Mocked mode. Persona: Olivia (owner) in
// Settings (#/settings). RBAC negative paths are server-enforced, so we force a
// status via state.fail and assert the toast the UI surfaces. 2FA enable/disable
// (SET-6) needs better-auth's real flow → full-stack (see auth.spec fixme note).

const card = (page: import("@playwright/test").Page, heading: string) =>
  page.locator(".card", { has: page.getByRole("heading", { name: heading }) });

function gotoSettings(state: MockState, over: Partial<MockState> = {}): void {
  seedSession(state);
  Object.assign(state, over);
}

test.describe("Settings", () => {
  test("ADMIN-1 — /admin defaults to Members and the sub-nav switches sections", async ({
    appPage,
    state,
  }) => {
    gotoSettings(state);
    await appPage.goto("/#/admin");
    await expect(card(appPage, "Members")).toBeVisible();

    await appPage.getByRole("link", { name: "API keys" }).click();
    await expect(card(appPage, "API keys")).toBeVisible();
    await expect(appPage).toHaveURL(/#\/admin\/api-keys$/);
  });

  test("SET-1 — empty git connections offer a Connect GitHub action", async ({
    appPage,
    state,
  }) => {
    gotoSettings(state);
    await appPage.goto("/#/admin/connections");
    const c = card(appPage, "Git connections");
    await expect(c.getByText("No git connections")).toBeVisible();
    await expect(
      c.locator(".card-head").getByRole("link", { name: "Connect GitHub" }),
    ).toHaveAttribute("href", "/api/v1/vcs/github/app/install");
  });

  test("SET-2 — Olivia changes a member's role", async ({ appPage, state }) => {
    gotoSettings(state, {
      members: [
        {
          id: "m_sam",
          userId: "u_sam",
          email: "sam@local.test",
          name: "Sam",
          role: "deployer",
          createdAt: "2026-06-01T00:00:00Z",
        },
      ],
    });
    await appPage.goto("/#/admin/members");
    const c = card(appPage, "Members");
    await c.getByRole("combobox", { name: "Role for Sam" }).selectOption("admin");
    await expect(appPage.getByText("Sam is now admin")).toBeVisible();
    expect(
      state.calls.some((x) => x.method === "PATCH" && x.path === "/api/v1/members/m_sam"),
    ).toBe(true);
  });

  test("SET-3 — a last-owner invariant violation surfaces a clear message", async ({
    appPage,
    state,
  }) => {
    gotoSettings(state, {
      members: [
        {
          id: "m_olivia",
          userId: "u_olivia",
          email: "owner@local.test",
          name: "Olivia",
          role: "owner",
          createdAt: "2026-06-01T00:00:00Z",
        },
      ],
      fail: { "PATCH /members/m_olivia": { status: 409, body: { detail: "last owner" } } },
    });
    await appPage.goto("/#/admin/members");
    const c = card(appPage, "Members");
    await c.getByRole("combobox", { name: "Role for Olivia" }).selectOption("viewer");
    await expect(
      appPage.getByText("That change would break the org's owner invariants"),
    ).toBeVisible();
  });

  test("SET-2b — removing a member needs confirmation", async ({ appPage, state }) => {
    gotoSettings(state, {
      members: [
        {
          id: "m_sam",
          userId: "u_sam",
          email: "sam@local.test",
          name: "Sam",
          role: "deployer",
          createdAt: "2026-06-01T00:00:00Z",
        },
      ],
    });
    await appPage.goto("/#/admin/members");
    const c = card(appPage, "Members");
    await c.getByRole("button", { name: "Remove Sam" }).click();
    const dialog = appPage.getByRole("alertdialog");
    await expect(dialog.getByRole("heading", { name: "Remove member?" })).toBeVisible();
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(appPage.getByText("Member removed")).toBeVisible();
  });

  test("SET-4 — Olivia sends an invite and gets a shareable accept link", async ({
    appPage,
    state,
  }) => {
    gotoSettings(state);
    await appPage.goto("/#/admin/members");
    const c = card(appPage, "Members");
    await c.getByPlaceholder("teammate@example.com").fill("newbie@local.test");
    await c.getByRole("combobox", { name: "Invite role" }).selectOption("viewer");
    await c.getByRole("button", { name: "Send invite" }).click();

    await expect(appPage.getByText("Invite created")).toBeVisible();
    const minted = c.getByRole("status");
    await expect(minted).toContainText("/#/invite?token=");
    await expect(minted).toContainText("Share this link — it expires in 7 days.");
    // The pending invite is listed; revoke it.
    await c.getByRole("button", { name: "Revoke invite for newbie@local.test" }).click();
    await expect(appPage.getByText("Invite revoked")).toBeVisible();
  });

  test("SET-5 — minting an API key shows the token once, then it can be deleted", async ({
    appPage,
    state,
  }) => {
    gotoSettings(state);
    await appPage.goto("/#/admin/api-keys");
    const c = card(appPage, "API keys");
    await c.getByPlaceholder("ci-deploys").fill("ci-token");
    await c.getByRole("button", { name: "Create key" }).click();

    const minted = c.getByRole("status");
    await expect(minted).toContainText("ssk_live_one_time_token_xyz");
    await expect(minted).toContainText("Copy it now — it won't be shown again.");

    await c.getByRole("button", { name: "Delete the ci-token key" }).click();
    await appPage.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(appPage.getByText("API key deleted")).toBeVisible();
  });

  test("SET-7 — saving a Claude key enables the assistant and Test passes", async ({
    appPage,
    state,
  }) => {
    gotoSettings(state);
    await appPage.goto("/#/admin/ai");
    const c = card(appPage, "AI assistant");
    await expect(c.getByText("no key configured — chat is off")).toBeVisible();

    await c.getByPlaceholder("sk-ant-…").fill("sk-ant-test-key");
    await c.getByRole("button", { name: "Save", exact: true }).click();
    await expect(appPage.getByText("AI settings saved")).toBeVisible();

    await c.getByRole("button", { name: "Test connection" }).click();
    await expect(appPage.getByText("Key works (claude-sonnet-4-6)")).toBeVisible();
  });

  test("SET-8 — a non-admin saving AI settings is told they lack permission", async ({
    appPage,
    state,
  }) => {
    gotoSettings(state, { fail: { "PUT /ai-settings": { status: 403 } } });
    await appPage.goto("/#/admin/ai");
    const c = card(appPage, "AI assistant");
    await c.getByPlaceholder("sk-ant-…").fill("sk-ant-test-key");
    await c.getByRole("button", { name: "Save", exact: true }).click();
    await expect(appPage.getByText("Saving needs an org admin")).toBeVisible();
  });

  test("SET-9 — the updates card surfaces an available update", async ({ appPage, state }) => {
    gotoSettings(state, {
      updateState: {
        currentVersion: "1.4.0",
        latestVersion: "1.5.0",
        channel: "stable",
        updateAvailable: true,
        notesUrl: "https://example.com/notes",
        releasedAt: "2026-06-19T00:00:00Z",
        lastCheckedAt: "2026-06-20T00:00:00Z",
        lastError: null,
      },
    });
    await appPage.goto("/#/admin/updates");
    const c = card(appPage, "Updates");
    await expect(c.getByText("Update available")).toBeVisible();
    await expect(c.getByText("1.5.0")).toBeVisible();
    await expect(c.getByRole("button", { name: "Update now" })).toBeVisible();

    await c.getByRole("button", { name: "Check for updates" }).click();
    await expect(appPage.getByText("Update available: 1.5.0")).toBeVisible();
  });
});
