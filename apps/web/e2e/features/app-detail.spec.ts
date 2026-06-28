import { test, expect, type MockState } from "../fixtures/test";
import { seedSession } from "../utils/actions";

// APP DETAIL scenarios (docs/testing/04). Mocked mode. Persona: Olivia (owner)
// on an app's page (#/apps/<id>). Live logs/console/WS frames (APP-5, LOG-*,
// CON-*) belong to the full-stack project — the two log WebSockets simply fail
// to connect here and the cards show their empty states, which is fine.

const APP_ID = "app_api";

function seedApp(state: MockState, over: Partial<MockState> = {}): void {
  seedSession(state);
  state.apps = [
    {
      id: APP_ID,
      name: "api",
      repo: "https://github.com/olivia/api.git",
      branch: "main",
      port: 8080,
      cpu: 0.5,
      memoryMb: 256,
    },
  ];
  Object.assign(state, over);
}

/** The Live-metrics card (scopes the running/stopped pill + lifecycle buttons). */
const metricsCard = (page: import("@playwright/test").Page) =>
  page.locator(".card", { has: page.getByRole("heading", { name: "Live metrics" }) });

test.describe("App detail", () => {
  test("APP-1 — the header shows repo, branch and resources", async ({ appPage, state }) => {
    seedApp(state);
    await appPage.goto("/#/apps/" + APP_ID);

    await expect(appPage.getByRole("heading", { level: 1, name: "api" })).toBeVisible();
    await expect(appPage.getByText(/github\.com\/olivia\/api\.git · port 8080/)).toBeVisible();
    await expect(appPage.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
  });

  test("APP-tabs — Deployments is the default tab and clicking a tab switches sections", async ({
    appPage,
    state,
  }) => {
    seedApp(state);
    await appPage.goto("/#/apps/" + APP_ID);
    const card = (name: string) =>
      appPage.locator(".card", { has: appPage.getByRole("heading", { name }) });

    // Default tab = Deployments; other sections are not mounted.
    await expect(card("Deployments")).toBeVisible();
    await expect(card("Environment")).toHaveCount(0);

    // Clicking a tab reveals its section (and deep-links via ?tab=).
    await appPage.getByRole("link", { name: "Environment" }).click();
    await expect(card("Environment")).toBeVisible();
    await expect(card("Deployments")).toHaveCount(0);
    await expect(appPage).toHaveURL(/\?tab=environment$/);
  });

  test("APP-2/3 — running metrics show, and Stop flips the app to stopped", async ({
    appPage,
    state,
  }) => {
    seedApp(state);
    await appPage.goto("/#/apps/" + APP_ID + "?tab=metrics");
    const card = metricsCard(appPage);

    // First metrics poll => running.
    await expect(card.locator('[data-status="running"]')).toBeVisible();
    await expect(card.locator(".metric-head", { hasText: "CPU" })).toBeVisible();

    await card.getByRole("button", { name: "Stop" }).click();
    await expect(card.locator('[data-status="stopped"]')).toBeVisible();
    await expect(card.getByRole("button", { name: "Start" })).toBeVisible();
    await expect(card.getByText("No running container.")).toBeVisible();
  });

  test("APP-7 — Olivia adds an env var, saves, and the secret is masked on reload", async ({
    appPage,
    state,
  }) => {
    seedApp(state);
    await appPage.goto("/#/apps/" + APP_ID + "?tab=environment");
    const card = appPage.locator(".card", {
      has: appPage.getByRole("heading", { name: "Environment" }),
    });
    await expect(card.getByText("No environment variables.")).toBeVisible();

    await card.getByRole("button", { name: "+ Add" }).click();
    await card.getByPlaceholder("KEY").fill("API_TOKEN");
    await card.getByText("secret").click(); // mark as secret
    await card.getByPlaceholder("value").fill("s3cr3t-value");
    await card.getByRole("button", { name: "Save environment" }).click();

    await expect(card.getByText("Saved. Redeploy to apply.")).toBeVisible();
    // After reload the stored secret comes back masked (value cleared).
    await expect(card.getByPlaceholder("KEY")).toHaveValue("API_TOKEN");
    await expect(card.getByPlaceholder("•••••• (unchanged)")).toBeVisible();
  });

  test("APP-9 — adding a domain lists it with a cert-status pill", async ({ appPage, state }) => {
    seedApp(state);
    await appPage.goto("/#/apps/" + APP_ID + "?tab=domains");
    const card = appPage.locator(".card", {
      has: appPage.getByRole("heading", { name: "Domains" }),
    });
    await expect(card.getByText("No domains")).toBeVisible();

    await card.getByPlaceholder("app.example.com").fill("api.example.com");
    await card.getByRole("button", { name: "Add domain" }).click();

    await expect(card.getByText("api.example.com")).toBeVisible();
    await expect(card.locator('[data-status="pending"]')).toBeVisible();
  });

  test("APP-10 — a rejected domain surfaces the server's error", async ({ appPage, state }) => {
    seedApp(state, {
      fail: {
        [`POST /apps/${APP_ID}/domains`]: {
          status: 400,
          body: { detail: "domain already in use" },
        },
      },
    });
    await appPage.goto("/#/apps/" + APP_ID + "?tab=domains");
    const card = appPage.locator(".card", {
      has: appPage.getByRole("heading", { name: "Domains" }),
    });
    await card.getByPlaceholder("app.example.com").fill("taken.example.com");
    await card.getByRole("button", { name: "Add domain" }).click();

    await expect(appPage.getByText("domain already in use")).toBeVisible();
    await expect(card.getByText("No domains")).toBeVisible(); // nothing was added
  });

  test("APP-11 — creating a webhook reveals the URL and one-time secret", async ({
    appPage,
    state,
  }) => {
    seedApp(state);
    await appPage.goto("/#/apps/" + APP_ID + "?tab=settings");
    const card = appPage.locator(".card", {
      has: appPage.getByRole("heading", { name: "Auto-deploy webhook" }),
    });
    await expect(card.getByText("No webhook yet. Create one to deploy on git push.")).toBeVisible();

    await card.getByRole("button", { name: "Create" }).click();
    await expect(card.getByText(/\/api\/v1\/webhooks\//)).toBeVisible();
    await expect(card.getByText("Secret (shown once)")).toBeVisible();
    await expect(card.getByText("whsec_one_time_abc123")).toBeVisible();
    await expect(card.getByRole("button", { name: "Rotate" })).toBeVisible();
  });

  test("APP-12 — changing the build strategy persists", async ({ appPage, state }) => {
    seedApp(state);
    await appPage.goto("/#/apps/" + APP_ID + "?tab=settings");
    const card = appPage.locator(".card", {
      has: appPage.getByRole("heading", { name: "Build settings" }),
    });
    await card.getByLabel("Build strategy").selectOption("static");
    await expect(
      card.getByText("Serve a directory of pre-built static files over a tiny HTTP server."),
    ).toBeVisible();
    await card.getByRole("button", { name: "Save build settings" }).click();

    await expect(
      appPage.getByText("Build settings saved — applies on the next deploy"),
    ).toBeVisible();
    expect(
      state.calls.some((c) => c.method === "PATCH" && c.path === `/api/v1/apps/${APP_ID}`),
    ).toBe(true);
  });

  test("APP-13 — the schedules card shows its empty state", async ({ appPage, state }) => {
    seedApp(state);
    await appPage.goto("/#/apps/" + APP_ID + "?tab=settings");
    const card = appPage.locator(".card", {
      has: appPage.getByRole("heading", { name: "Scheduled jobs" }),
    });
    await expect(card.getByText("No schedules")).toBeVisible();
    await expect(card.getByPlaceholder("0 3 * * *")).toBeVisible();
  });

  test("APP-4/6 — a succeeded deployment can be rolled back via confirm", async ({
    appPage,
    state,
  }) => {
    seedApp(state, {
      deployments: {
        [APP_ID]: [
          {
            id: "dep_1",
            status: "succeeded",
            trigger: "manual",
            commitAfter: "abc1234def",
            queuedAt: "2026-06-20T10:00:00Z",
            meta: { container: "api-abc1234" },
          },
        ],
      },
    });
    await appPage.goto("/#/apps/" + APP_ID + "?tab=deployments");
    const card = appPage.locator(".card", {
      has: appPage.getByRole("heading", { name: "Deployments" }),
    });
    await expect(card.locator('[data-status="succeeded"]')).toBeVisible();

    await card.getByRole("button", { name: "Rollback" }).click();
    const dialog = appPage.getByRole("alertdialog");
    await expect(
      dialog.getByRole("heading", { name: "Roll back to this deployment?" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Roll back" }).click();

    await expect(appPage.getByText("Rollback queued")).toBeVisible();
    expect(
      state.calls.some(
        (c) => c.method === "POST" && c.path === "/api/v1/deployments/dep_1/rollback",
      ),
    ).toBe(true);
  });
});
