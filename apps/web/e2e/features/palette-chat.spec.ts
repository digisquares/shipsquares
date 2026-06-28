import { test, expect } from "../fixtures/test";
import { seedSession } from "../utils/actions";

// COMMAND PALETTE (⌘K) + ASSISTANT CHAT scenarios (docs/testing/04). Mocked mode.

test.describe("Command palette", () => {
  test("CMD-1 — ⌘K opens the palette, filters, and runs a command", async ({ appPage, state }) => {
    seedSession(state);
    await appPage.goto("/");
    await expect(appPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await appPage.keyboard.press("ControlOrMeta+k");
    const dialog = appPage.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();

    await dialog
      .getByRole("combobox", { name: "Search commands or ask the assistant" })
      .fill("Settings");
    await dialog.getByRole("option", { name: /Go to Settings/ }).click();

    // The command navigated to Settings.
    await expect(appPage.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  });

  test("CMD-2 — Escape closes the palette", async ({ appPage, state }) => {
    seedSession(state);
    await appPage.goto("/");
    await expect(appPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await appPage.keyboard.press("ControlOrMeta+k");
    const dialog = appPage.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    // Escape is handled on the combobox itself — press it there (focuses first).
    await dialog
      .getByRole("combobox", { name: "Search commands or ask the assistant" })
      .press("Escape");
    await expect(dialog).toBeHidden();
  });
});

test.describe("Assistant chat", () => {
  test("CHAT-5 — an unconfigured org is pointed at Settings instead of hanging", async ({
    appPage,
    state,
  }) => {
    seedSession(state); // state.ai.configured defaults to false
    await appPage.goto("/");
    await appPage.getByRole("button", { name: "Open the assistant" }).click();
    const panel = appPage.getByRole("complementary", { name: "ShipSquares assistant" });
    await expect(panel).toBeVisible();

    await panel.getByLabel("Message the assistant").fill("how many apps do I have?");
    await panel.getByRole("button", { name: "Send" }).click();

    await expect(panel.getByText(/AI chat isn't configured for this org yet/)).toBeVisible();
    await expect(panel.getByRole("link", { name: "Settings → AI assistant" })).toBeVisible();
  });

  test("CHAT-1 — a configured assistant streams its reply", async ({ appPage, state }) => {
    seedSession(state);
    state.ai = {
      ...state.ai,
      configured: true,
      enabled: true,
      keySource: "org",
      keyHint: "sk-ant-…x",
    };
    await appPage.goto("/");
    await appPage.getByRole("button", { name: "Open the assistant" }).click();
    const panel = appPage.getByRole("complementary", { name: "ShipSquares assistant" });

    await panel.getByLabel("Message the assistant").fill("list my apps");
    await panel.getByRole("button", { name: "Send" }).click();

    // The user's message and the streamed-then-finalized reply both render.
    await expect(panel.getByText("list my apps")).toBeVisible();
    await expect(panel.getByText("Here are your apps.")).toBeVisible();
  });

  // CHAT-4 (Stop aborts a streaming turn) needs a throttled/long-lived SSE stream
  // the test can interrupt mid-flight. Playwright's route.fulfill delivers the
  // whole body at once, so the turn finishes before Stop is clickable. Belongs to
  // the full-stack project (real streaming) — see docs/testing/07.
  test.fixme("CHAT-4 — Stop aborts a streaming turn (needs live stream)", async () => {});
});
