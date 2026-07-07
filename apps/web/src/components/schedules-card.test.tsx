// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations, renderComponent } from "../test/component";

import { SchedulesCard } from "./schedules-card";

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

const json = (ok: boolean, status: number, body: unknown) =>
  ({ ok, status, json: async () => body }) as Response;

const sched = {
  id: "sch_1",
  name: "nightly-cleanup",
  target: "app_container",
  appId: "app_1",
  command: "node scripts/cleanup.js",
  cron: "0 3 * * *",
  enabled: true,
  createdAt: new Date().toISOString(),
};

// /schedules is the list under test; per-schedule /runs is a benign fan-out.
function mockFetch(schedules: () => Response) {
  globalThis.fetch = vi.fn((path: string) =>
    Promise.resolve(path.includes("/runs") ? json(true, 200, []) : schedules()),
  ) as unknown as typeof fetch;
}

describe("SchedulesCard (component)", () => {
  it("lists this app's schedules", async () => {
    mockFetch(() => json(true, 200, [sched]));
    const { container } = renderComponent(<SchedulesCard appId="app_1" />);
    expect(await screen.findByText("nightly-cleanup")).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it("shows an empty state when no schedules match this app", async () => {
    mockFetch(() => json(true, 200, [{ ...sched, appId: "other_app" }]));
    renderComponent(<SchedulesCard appId="app_1" />);
    expect(await screen.findByText("No schedules")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an error state with Retry (not a fake empty) on failure, and recovers", async () => {
    let first = true;
    globalThis.fetch = vi.fn((path: string) => {
      if (path.includes("/runs")) return Promise.resolve(json(true, 200, []));
      if (first) {
        first = false;
        return Promise.resolve(json(false, 500, null));
      }
      return Promise.resolve(json(true, 200, [sched]));
    }) as unknown as typeof fetch;
    renderComponent(<SchedulesCard appId="app_1" />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/couldn't load schedules/i)).toBeTruthy();
    expect(screen.queryByText("No schedules")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("nightly-cleanup")).toBeTruthy();
  });
});
