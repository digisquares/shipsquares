// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations, renderComponent } from "../test/component";

import { UpdatesCard, type UpdateState } from "./updates";

// Auto-accept the confirm dialog so the apply path proceeds without the host.
vi.mock("../lib/confirm", () => ({ confirm: () => Promise.resolve(true) }));

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

const AVAILABLE: UpdateState = {
  currentVersion: "v0.1.0",
  latestVersion: "v0.2.0",
  channel: "stable",
  updateAvailable: true,
  notesUrl: "https://github.com/digisquares/shipsquares/releases/tag/v0.2.0",
  releasedAt: "2026-06-20T10:00:00.000Z",
  lastCheckedAt: "2026-06-20T11:00:00.000Z",
  lastError: null,
};

interface Call {
  url: string;
  method: string;
}
/** GET /system/updates → state; POST /check → checkResult; POST /apply → 202;
 *  GET /progress → running. Records calls for assertions. */
function mockApi(state: UpdateState, checkResult?: UpdateState) {
  const calls: Call[] = [];
  let settings = { channel: "stable", autoUpdate: false };
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    let data: unknown = state;
    let status = 200;
    if (url.endsWith("/system/updates/check") && method === "POST") data = checkResult ?? state;
    else if (url.endsWith("/system/updates/apply") && method === "POST") {
      data = { accepted: true, toVersion: state.latestVersion };
      status = 202;
    } else if (url.endsWith("/system/updates/progress")) {
      data = { state: "running", step: "download", message: "downloading", ts: null };
    } else if (url.endsWith("/system/updates/settings")) {
      if (method === "PUT" && init?.body)
        settings = { ...settings, ...JSON.parse(String(init.body)) };
      data = settings;
    }
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) });
  }) as unknown as typeof fetch;
  return calls;
}

describe("UpdatesCard", () => {
  it("shows an available update with the version + release notes", async () => {
    mockApi(AVAILABLE);
    const { container } = renderComponent(<UpdatesCard />);
    expect(await screen.findByText("Update available")).toBeTruthy();
    expect(screen.getByText("v0.2.0")).toBeTruthy();
    expect(screen.getByRole("link", { name: /release notes/i })).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it("shows up-to-date when current === latest", async () => {
    mockApi({ ...AVAILABLE, latestVersion: "v0.1.0", updateAvailable: false, notesUrl: null });
    renderComponent(<UpdatesCard />);
    expect(await screen.findByText("Up to date")).toBeTruthy();
  });

  it("re-checks on demand and reflects the new result", async () => {
    mockApi(
      { ...AVAILABLE, updateAvailable: false, latestVersion: "v0.1.0", notesUrl: null },
      AVAILABLE,
    );
    renderComponent(<UpdatesCard />);
    expect(await screen.findByText("Up to date")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /check for updates/i }));
    expect(await screen.findByText("Update available")).toBeTruthy();
  });

  it("applies an update and shows progress", async () => {
    const calls = mockApi(AVAILABLE);
    renderComponent(<UpdatesCard />);
    fireEvent.click(await screen.findByRole("button", { name: /update now/i }));
    expect(await screen.findByText(/starting update/i)).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith("/system/updates/apply") && c.method === "POST")).toBe(
      true,
    );
  });

  it("toggles auto-update", async () => {
    mockApi(AVAILABLE);
    renderComponent(<UpdatesCard />);
    const cb = (await screen.findByRole("checkbox")) as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    await waitFor(() => expect(cb.checked).toBe(true));
  });
});
