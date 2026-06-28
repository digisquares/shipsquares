import { test, expect, type BackupConfig } from "../fixtures/test";
import { seedSession } from "../utils/actions";

// BACKUPS scenarios (docs/testing/04). Mocked mode. Configs are created via the
// API/CLI in real life; here we seed them and prove the operator's screen.

const physical: BackupConfig = {
  id: "bc_pg",
  serverId: "srv_1",
  databaseId: "appdb",
  type: "physical",
  schedule: "0 3 * * *",
  walArchive: true,
  keepNewest: 7,
  retentionDays: 30,
  enabled: true,
  lastWalAt: null,
  nextRunAt: "2026-06-22T03:00:00Z",
  lastRun: { status: "succeeded", sizeBytes: 10485760, finishedAt: "2026-06-20T03:00:00Z" },
};

test.describe("Backups", () => {
  test("BAK-1 — a PITR config lists schedule, WAL flag, and last-run size", async ({
    appPage,
    state,
  }) => {
    seedSession(state);
    state.backupConfigs = [physical];
    await appPage.goto("/#/backups");
    await expect(appPage.getByRole("heading", { name: "Backups" })).toBeVisible();
    const row = appPage.locator("li.backup-item");
    await expect(row.getByText("PITR")).toBeVisible();
    await expect(row.getByText("WAL")).toBeVisible();
    await expect(row.getByText("0 3 * * *")).toBeVisible();
    await expect(row.locator('[data-status="succeeded"]')).toBeVisible();
  });

  test("BAK-2 — Run now starts a backup and history can be expanded", async ({
    appPage,
    state,
  }) => {
    seedSession(state);
    state.backupConfigs = [physical];
    state.backupRuns = {
      bc_pg: [
        {
          id: "run_1",
          status: "succeeded",
          sizeBytes: 10485760,
          error: null,
          startedAt: "2026-06-20T03:00:00Z",
        },
      ],
    };
    await appPage.goto("/#/backups");
    const row = appPage.locator("li.backup-item");

    await row.getByRole("button", { name: "Run now" }).click();
    await expect(appPage.getByText("Backup started")).toBeVisible();
    expect(
      state.calls.some(
        (c) => c.method === "POST" && c.path === "/api/v1/backup-configs/bc_pg/base-backup",
      ),
    ).toBe(true);

    await row.getByRole("button", { name: "Runs" }).click();
    await expect(row.locator('[data-status="succeeded"]')).toHaveCount(2); // last-run + history row
  });

  test("BAK-3 — a paused config can't be run", async ({ appPage, state }) => {
    seedSession(state);
    state.backupConfigs = [{ ...physical, id: "bc_paused", enabled: false, lastRun: null }];
    await appPage.goto("/#/backups");
    const row = appPage.locator("li.backup-item");
    await expect(row.getByText("paused")).toBeVisible();
    await expect(row.getByRole("button", { name: "Run now" })).toBeDisabled();
  });
});
