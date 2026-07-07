// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations, renderComponent } from "../test/component";

import { Activity } from "./activity";

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

const json = (ok: boolean, status: number, body: unknown) =>
  ({ ok, status, json: async () => body }) as Response;

const row = (id: string, appName: string) => ({
  id,
  appId: `app_${id}`,
  appName,
  status: "succeeded",
  trigger: "manual",
  commitAfter: "abcdef0",
  queuedAt: new Date().toISOString(),
});

const page = (rows: ReturnType<typeof row>[], nextCursor: string | null) =>
  json(true, 200, { data: rows, page: { nextCursor, hasMore: nextCursor !== null } });

describe("Activity (component)", () => {
  it("lists the first page and appends the next via Load more", async () => {
    globalThis.fetch = vi.fn((path: string) =>
      Promise.resolve(
        path.includes("cursor=")
          ? page([row("2", "web")], null)
          : page([row("1", "api")], "cursor-1"),
      ),
    ) as unknown as typeof fetch;

    const { container } = renderComponent(<Activity />);
    expect(await screen.findByText("api")).toBeTruthy();
    const loadMore = screen.getByRole("button", { name: /load more/i });
    await expectNoA11yViolations(container);

    fireEvent.click(loadMore);
    expect(await screen.findByText("web")).toBeTruthy();
    // first page still present (appended, not replaced); no more pages → button gone
    expect(screen.getByText("api")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });

  it("shows an error state with Retry (not empty) on initial failure, and recovers", async () => {
    let first = true;
    globalThis.fetch = vi.fn(() => {
      if (first) {
        first = false;
        return Promise.resolve(json(false, 500, null));
      }
      return Promise.resolve(page([row("1", "api")], null));
    }) as unknown as typeof fetch;

    renderComponent(<Activity />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/couldn't load activity/i)).toBeTruthy();
    expect(screen.queryByText("No activity yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("api")).toBeTruthy();
  });
});
