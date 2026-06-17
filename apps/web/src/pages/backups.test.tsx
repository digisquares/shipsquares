// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations, renderComponent } from "../test/component";

import { Backups, formatBytes } from "./backups";

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

const mockConfigs = (configs: unknown[]) => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => configs,
  }) as unknown as typeof fetch;
};

describe("formatBytes", () => {
  it("renders human sizes and a dash for null", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(3_300_000)).toBe("3.1 MB");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5.0 GB");
  });
});

describe("Backups (component)", () => {
  it("lists a config with schedule, next run, last-run size + a Run-now action", async () => {
    mockConfigs([
      {
        id: "bkc_1",
        serverId: "dbs_1",
        databaseId: "db_1",
        type: "logical",
        schedule: "0 3 * * *",
        walArchive: false,
        keepNewest: 14,
        retentionDays: 14,
        enabled: true,
        lastWalAt: null,
        nextRunAt: new Date(Date.now() + 3_600_000).toISOString(),
        lastRun: { status: "success", sizeBytes: 3_300_000, finishedAt: new Date().toISOString() },
      },
    ]);
    const { container } = renderComponent(<Backups />);
    expect(await screen.findByText("db_1")).toBeTruthy();
    expect(screen.getByText("0 3 * * *")).toBeTruthy();
    expect(screen.getByText("3.1 MB")).toBeTruthy();
    expect(screen.getByText("logical")).toBeTruthy();
    expect(screen.getByRole("button", { name: /run now/i })).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it("shows an empty state when there are no configs", async () => {
    mockConfigs([]);
    renderComponent(<Backups />);
    expect(await screen.findByText("No backup configs")).toBeTruthy();
  });
});
