import axe from "axe-core";

import { test, expect } from "../fixtures/test";
import { seedSession } from "../utils/actions";

// CROSS-CUTTING scenarios (docs/testing/04): deep links, accessibility, and the
// server-enforced RBAC surface.

test.describe("Deep links", () => {
  const cases: Array<{
    hash: string;
    assert: (p: import("@playwright/test").Page) => Promise<void>;
  }> = [
    {
      hash: "#/settings",
      assert: async (p) =>
        expect(p.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible(),
    },
    {
      hash: "#/catalog",
      assert: async (p) => expect(p.getByRole("heading", { name: "Catalog" })).toBeVisible(),
    },
    {
      hash: "#/backups",
      assert: async (p) => expect(p.getByRole("heading", { name: "Backups" })).toBeVisible(),
    },
    { hash: "#/studio", assert: async (p) => expect(p.getByText("Database Studio")).toBeVisible() },
  ];

  for (const c of cases) {
    test(`DEEPLINK-1 — ${c.hash} renders directly when logged in`, async ({ appPage, state }) => {
      seedSession(state);
      await appPage.goto("/" + c.hash);
      await c.assert(appPage);
    });
  }
});

test.describe("Accessibility", () => {
  test("A11Y-1 — the dashboard has no critical/serious axe violations", async ({
    appPage,
    state,
  }) => {
    seedSession(state);
    state.apps = [{ id: "app_1", name: "api", branch: "main", repo: "https://x/y.git" }];
    await appPage.goto("/");
    await expect(appPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await appPage.addScriptTag({ content: axe.source });
    const results = (await appPage.evaluate(async () => {
      const a = (
        window as unknown as { axe: { run: (c: Document, o: unknown) => Promise<unknown> } }
      ).axe;
      return a.run(document, { resultTypes: ["violations"] });
    })) as { violations: Array<{ id: string; impact: string | null; nodes: unknown[] }> };
    const serious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(
      serious,
      JSON.stringify(serious.map((v) => ({ id: v.id, nodes: v.nodes.length }))),
    ).toEqual([]);
  });
});

test.describe("RBAC (server-enforced)", () => {
  test("J6 — a viewer who forces a create gets a permission error", async ({ appPage, state }) => {
    seedSession(state, "viewer");
    // The control plane rejects the write with 403; the UI must surface it, not
    // silently add the app.
    state.fail = {
      "POST /apps": { status: 403, body: { detail: "viewer role can't create apps" } },
    };
    await appPage.goto("/");
    const newApp = appPage
      .locator(".card", { has: appPage.getByRole("heading", { name: "Apps" }) })
      .locator(".card-head")
      .getByRole("button", { name: "New app" });
    await newApp.click();
    await appPage.getByLabel("App name").fill("blocked-app");
    await appPage.getByRole("button", { name: "Create", exact: true }).click();

    // Surfaced both as an inline note and a toast — assert at least one is shown.
    await expect(appPage.getByText("viewer role can't create apps").first()).toBeVisible();
    await expect(appPage.getByRole("link", { name: "blocked-app" })).toHaveCount(0);
  });
});
