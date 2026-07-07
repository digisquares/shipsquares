// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations, renderComponent } from "../test/component";

import { Dashboard } from "./dashboard";

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

const json = (ok: boolean, status: number, body: unknown) =>
  ({ ok, status, json: async () => body }) as Response;

const oneApp = {
  data: [{ id: "app_1", name: "api", branch: "main", repo: "git@example.com:api" }],
};

// Dashboard fans out several fetches on mount (apps, per-app deployments,
// notification-channels). Route by URL; `apps` is the one under test.
function mockFetch(apps: () => Response) {
  globalThis.fetch = vi.fn((path: string) => {
    if (path.includes("/deployments")) return Promise.resolve(json(true, 200, { data: [] }));
    if (path.startsWith("/api/v1/notification-channels"))
      return Promise.resolve(json(true, 200, []));
    if (path.startsWith("/api/v1/apps")) return Promise.resolve(apps());
    return Promise.resolve(json(true, 200, { data: [] }));
  }) as unknown as typeof fetch;
}

describe("Dashboard (component)", () => {
  it("lists apps with a Deploy action", async () => {
    mockFetch(() => json(true, 200, oneApp));
    const { container } = renderComponent(<Dashboard />);
    expect(await screen.findByText("api")).toBeTruthy();
    expect(screen.getByRole("link", { name: "api" })).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it("shows an empty state (not stuck loading) when there are no apps", async () => {
    mockFetch(() => json(true, 200, { data: [] }));
    renderComponent(<Dashboard />);
    expect(await screen.findByText("No apps yet")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an error state with Retry on failure — not a permanent skeleton — and recovers", async () => {
    let firstApps = true;
    globalThis.fetch = vi.fn((path: string) => {
      if (path.includes("/deployments")) return Promise.resolve(json(true, 200, { data: [] }));
      if (path.startsWith("/api/v1/notification-channels"))
        return Promise.resolve(json(true, 200, []));
      if (path.startsWith("/api/v1/apps")) {
        if (firstApps) {
          firstApps = false;
          return Promise.resolve(json(false, 500, null));
        }
        return Promise.resolve(json(true, 200, oneApp));
      }
      return Promise.resolve(json(true, 200, { data: [] }));
    }) as unknown as typeof fetch;
    renderComponent(<Dashboard />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/couldn't load apps/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("api")).toBeTruthy();
  });
});
