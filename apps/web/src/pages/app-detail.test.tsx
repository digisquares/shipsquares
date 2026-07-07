// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations, renderComponent } from "../test/component";

import { AppDetail } from "./app-detail";

// app-detail opens WebSockets on mount (live + runtime logs); jsdom has none.
class FakeWebSocket {
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {}
  send() {}
  close() {
    this.onclose?.();
  }
}

const origFetch = globalThis.fetch;
const origWS = globalThis.WebSocket;
beforeEach(() => {
  (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
});
afterEach(() => {
  globalThis.fetch = origFetch;
  (globalThis as { WebSocket: unknown }).WebSocket = origWS;
  vi.restoreAllMocks();
});

const json = (ok: boolean, status: number, body: unknown) =>
  ({ ok, status, json: async () => body }) as Response;

const app = {
  id: "app_1",
  name: "api",
  repo: "git@example.com:api",
  image: null,
  branch: "main",
  port: 8080,
  cpu: null,
  memoryMb: null,
  buildStrategy: "nixpacks",
};

// Route app-detail's mount fetches; `appResp` is the app document under test.
function mockFetch(appResp: () => Response) {
  globalThis.fetch = vi.fn((path: string) => {
    if (path.includes("/metrics")) return Promise.resolve(json(true, 200, { running: false }));
    if (path.endsWith("/env")) return Promise.resolve(json(true, 200, []));
    if (path.endsWith("/domains")) return Promise.resolve(json(true, 200, []));
    if (path.endsWith("/webhook")) return Promise.resolve(json(false, 404, null));
    if (path.includes("/deployments")) return Promise.resolve(json(true, 200, { data: [] }));
    if (path === "/api/v1/apps/app_1") return Promise.resolve(appResp());
    return Promise.resolve(json(true, 200, { data: [] }));
  }) as unknown as typeof fetch;
}

describe("AppDetail (component)", () => {
  it("renders the app once loaded", async () => {
    mockFetch(() => json(true, 200, app));
    const { container } = renderComponent(<AppDetail appId="app_1" />);
    expect(await screen.findByRole("heading", { name: "api" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: /app sections/i })).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it("shows a dead-end 'App not found' on a 404 (deleted / stale link)", async () => {
    mockFetch(() => json(false, 404, null));
    renderComponent(<AppDetail appId="app_1" />);
    expect(await screen.findByText("App not found")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull(); // not a retryable error — it's gone
  });

  it("shows a retryable error (not 'App not found') on a transient failure, and recovers", async () => {
    let firstApp = true;
    mockFetch(() => {
      if (firstApp) {
        firstApp = false;
        return json(false, 500, null);
      }
      return json(true, 200, app);
    });
    renderComponent(<AppDetail appId="app_1" />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/couldn't load this app/i)).toBeTruthy();
    expect(screen.queryByText("App not found")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByRole("heading", { name: "api" })).toBeTruthy();
  });
});
