import { test, expect } from "../fixtures/test";
import { seedSession } from "../utils/actions";

// PLATFORM scenarios (docs/web-ui/01 §3, P6). Mocked mode. Servers (control +
// worker nodes) and Activity (org-wide deployment feed) — infra that previously
// had no route in the SPA.

test.describe("Platform", () => {
  test("SRV-1 — servers list shows each node with role and health", async ({ appPage, state }) => {
    seedSession(state);
    state.servers = [
      {
        id: "srv_ctl",
        name: "control",
        host: "127.0.0.1",
        role: "control",
        status: "ready",
        dockerOk: true,
        caddyOk: true,
        createdAt: "2026-06-01T00:00:00Z",
      },
      {
        id: "srv_w1",
        name: "worker-1",
        host: "10.0.0.5",
        role: "worker",
        status: "unreachable",
        dockerOk: false,
        caddyOk: false,
        createdAt: "2026-06-02T00:00:00Z",
      },
    ];
    await appPage.goto("/#/servers");
    await expect(appPage.getByRole("heading", { level: 1, name: "Servers" })).toBeVisible();
    const card = appPage.locator(".card", {
      has: appPage.getByRole("heading", { name: "Servers" }),
    });
    await expect(card.getByText("worker-1")).toBeVisible();
    await expect(card.getByText("127.0.0.1")).toBeVisible();
    await expect(card.locator('[data-status="ready"]')).toBeVisible();
    await expect(card.locator('[data-status="unreachable"]')).toBeVisible();
  });

  test("SRV-2 — no servers shows the add-a-worker hint", async ({ appPage, state }) => {
    seedSession(state);
    await appPage.goto("/#/servers");
    await expect(appPage.getByText("No servers yet")).toBeVisible();
  });

  test("ACT-1 — activity lists recent deployments across apps", async ({ appPage, state }) => {
    seedSession(state);
    state.apps = [{ id: "app_api", name: "api" }];
    state.deployments = {
      app_api: [
        {
          id: "dep_1",
          status: "succeeded",
          trigger: "manual",
          commitAfter: "abc1234def",
          queuedAt: "2026-06-20T10:00:00Z",
        },
      ],
    };
    await appPage.goto("/#/activity");
    await expect(appPage.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
    const card = appPage.locator(".card", {
      has: appPage.getByRole("heading", { name: "Recent deployments" }),
    });
    await expect(card.getByRole("link", { name: "api" })).toBeVisible();
    await expect(card.locator('[data-status="succeeded"]')).toBeVisible();
    await expect(card.getByText("abc1234")).toBeVisible();
  });

  test("ACT-2 — no activity shows its empty state", async ({ appPage, state }) => {
    seedSession(state);
    await appPage.goto("/#/activity");
    await expect(appPage.getByText("No activity yet")).toBeVisible();
  });
});
