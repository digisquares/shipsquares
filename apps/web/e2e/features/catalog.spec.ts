import { test, expect } from "../fixtures/test";
import { seedSession } from "../utils/actions";

// CATALOG scenarios (docs/testing/04). Mocked mode. The installing→running
// transition is scripted by the mock (a service flips on its 2nd GET).

const CATALOG = [
  {
    slug: "postgres",
    slogan: "The world's most advanced open-source DB",
    category: "database",
    tags: ["db", "sql"],
  },
  { slug: "redis", slogan: "In-memory data store", category: "database", tags: ["db", "cache"] },
  { slug: "ghost", slogan: "Publishing platform", category: "cms", tags: ["blog", "cms"] },
];

test.describe("Catalog", () => {
  test("CAT-1 — search filters the template list", async ({ appPage, state }) => {
    seedSession(state);
    state.catalog = CATALOG;
    await appPage.goto("/#/catalog");
    await expect(appPage.getByRole("button", { name: "Install postgres" })).toBeVisible();
    await expect(appPage.getByRole("button", { name: "Install redis" })).toBeVisible();

    await appPage.getByLabel("Search templates").fill("redis");
    await expect(appPage.getByRole("button", { name: "Install redis" })).toBeVisible();
    await expect(appPage.getByRole("button", { name: "Install postgres" })).toHaveCount(0);
  });

  test("CAT-2 — installing a service polls from installing to running", async ({
    appPage,
    state,
  }) => {
    seedSession(state);
    state.catalog = CATALOG;
    await appPage.goto("/#/catalog");

    await appPage.getByRole("button", { name: "Install postgres" }).click();
    await expect(appPage.getByText("Installing postgres…")).toBeVisible();

    const installed = appPage.locator(".card", {
      has: appPage.getByRole("heading", { name: "Installed services" }),
    });
    await expect(installed.locator('[data-status="installing"]')).toBeVisible();
    // The 4s poll flips it to running.
    await expect(installed.locator('[data-status="running"]')).toBeVisible({ timeout: 10_000 });
  });

  test("CAT-3 — uninstalling a service needs confirmation", async ({ appPage, state }) => {
    seedSession(state);
    state.catalog = CATALOG;
    state.catalogServices = [
      { id: "svc_1", slug: "ghost", name: "ghost", status: "running", error: null },
    ];
    await appPage.goto("/#/catalog");
    const installed = appPage.locator(".card", {
      has: appPage.getByRole("heading", { name: "Installed services" }),
    });
    await installed.getByRole("button", { name: "Uninstall ghost" }).click();
    const dialog = appPage.getByRole("alertdialog");
    await expect(dialog.getByRole("heading", { name: "Uninstall ghost?" })).toBeVisible();
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(appPage.getByText("Uninstalled ghost")).toBeVisible();
  });

  test("CAT-4 — a service that needs domain wiring reports it clearly", async ({
    appPage,
    state,
  }) => {
    seedSession(state);
    state.catalog = CATALOG;
    state.fail = { "POST /catalog-services": { status: 400, body: { detail: "needs FQDN" } } };
    await appPage.goto("/#/catalog");
    await appPage.getByRole("button", { name: "Install ghost" }).click();
    await expect(
      appPage.getByText("ghost needs domain wiring (FQDN tokens) — not installable yet"),
    ).toBeVisible();
  });
});
