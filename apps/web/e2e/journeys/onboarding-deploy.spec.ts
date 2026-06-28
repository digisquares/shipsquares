import { test, expect } from "../fixtures/test";
import { openNewAppForm, signIn } from "../utils/actions";
import { runId } from "../utils/run-id";

// J1 — Olivia onboards and ships her first app (docs/testing/03-user-journeys.md).
// The CRITICAL PATH. The sign-in → create portion runs in mocked mode here; the
// live deploy (queued → running → succeeded over WebSocket + the app actually
// serving HTTP) is the real proof and belongs to the full-stack project.

test.describe("J1 — onboard and ship", () => {
  test("Olivia signs in and creates her first app", async ({ appPage }) => {
    await appPage.goto("/");

    // Sign in (mock accepts this password and flips the session).
    await signIn(appPage, "olivia@local.test");

    // Create the first app.
    const name = `hello-${runId()}`;
    const nameInput = await openNewAppForm(appPage);
    await nameInput.fill(name);
    await appPage.getByLabel("Git repository URL").fill("https://example.com/olivia/hello.git");
    await appPage.getByLabel("Container port").fill("8080");
    await appPage.getByRole("button", { name: "Create", exact: true }).click();

    await expect(appPage.getByRole("link", { name })).toBeVisible();
  });

  // Blocked until the full-stack project + WS log/status hooks land.
  // Needs: real control plane (MCL-1 seeded owner) and status-pill/log-viewer
  // assertions over live WebSocket frames (MCL-4). See docs/testing/07.
  test.fixme("Olivia deploys the app and watches it go green, then sees build logs (full-stack)", async ({
    page,
  }) => {
    // PLAYWRIGHT_STACK=full:
    //  1. real login (storageState from seed fixture)
    //  2. click Deploy on the app row
    //  3. expect [data-status="running"] then [data-status="succeeded"]
    //  4. open the deployment, expect the log viewer to contain the success line
    //  5. (full) GET the app's host port and expect 200
    void page;
  });
});
