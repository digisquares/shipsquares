// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations, renderComponent } from "../test/component";

import { Servers } from "./servers";

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

const respond = (ok: boolean, status: number, body: unknown) =>
  ({ ok, status, json: async () => body }) as Response;

const oneServer = {
  data: [
    {
      id: "srv_1",
      name: "worker-1",
      host: "10.0.0.2",
      role: "worker",
      status: "ready",
      dockerOk: true,
      caddyOk: true,
      createdAt: new Date().toISOString(),
    },
  ],
};

describe("Servers (component)", () => {
  it("lists servers with health + a re-check action", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(respond(true, 200, oneServer)) as unknown as typeof fetch;
    const { container } = renderComponent(<Servers />);
    expect(await screen.findByText("worker-1")).toBeTruthy();
    expect(screen.getByText("10.0.0.2")).toBeTruthy();
    expect(screen.getByRole("button", { name: /re-check worker-1/i })).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it("shows an empty state (not an error) when there are no servers", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(respond(true, 200, { data: [] })) as unknown as typeof fetch;
    renderComponent(<Servers />);
    expect(await screen.findByText("No servers yet")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an error state with Retry on failure — never a masquerading empty — and recovers", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(respond(false, 500, null))
      .mockResolvedValueOnce(respond(true, 200, oneServer)) as unknown as typeof fetch;
    const { container } = renderComponent(<Servers />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/couldn't load servers/i)).toBeTruthy();
    expect(screen.queryByText("No servers yet")).toBeNull();
    await expectNoA11yViolations(container);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("worker-1")).toBeTruthy();
  });
});
