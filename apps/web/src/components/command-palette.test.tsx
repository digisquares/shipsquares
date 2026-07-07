// @vitest-environment jsdom
import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations, renderComponent } from "../test/component";

import { CommandPalette } from "./command-palette";

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

const json = (ok: boolean, status: number, body: unknown) =>
  ({ ok, status, json: async () => body }) as Response;

function mockFetch(role: string) {
  globalThis.fetch = vi.fn((path: string) => {
    if (path.includes("/me/organizations"))
      return Promise.resolve(json(true, 200, [{ role, active: true }]));
    return Promise.resolve(json(true, 200, { data: [] })); // /apps
  }) as unknown as typeof fetch;
}

function openPalette() {
  act(() => {
    window.dispatchEvent(new CustomEvent("ss:command-palette"));
  });
}

describe("CommandPalette (component)", () => {
  it("lists every Workspace + Platform nav destination (derived from NAV)", async () => {
    mockFetch("viewer");
    const { container } = renderComponent(<CommandPalette />);
    openPalette();
    for (const label of [
      "Go to Overview",
      "Go to Database",
      "Go to Backups",
      "Go to Email",
      "Go to Catalog",
      "Go to Servers",
      "Go to DB Performance",
      "Go to Activity",
      "Go to Settings",
    ]) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
    await expectNoA11yViolations(container);
  });

  it("role-gates the Admin destination — hidden for viewers, shown for admins", async () => {
    mockFetch("viewer");
    const { unmount } = renderComponent(<CommandPalette />);
    openPalette();
    await screen.findByText("Go to Overview");
    expect(screen.queryByText("Go to Admin")).toBeNull();
    unmount();

    mockFetch("owner");
    renderComponent(<CommandPalette />);
    openPalette();
    expect(await screen.findByText("Go to Admin")).toBeTruthy();
  });
});
