// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations, renderComponent } from "../test/component";

import { MembersCard } from "./settings";

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

const json = (ok: boolean, status: number, body: unknown) =>
  ({ ok, status, json: async () => body }) as Response;

const member = {
  id: "mem_1",
  userId: "u_1",
  email: "ada@example.com",
  name: "Ada",
  role: "owner",
  createdAt: new Date().toISOString(),
};

// MembersCard also embeds InvitesPanel (fetches /members/invites) — route it benignly.
function mockFetch(members: () => Response) {
  globalThis.fetch = vi.fn((path: string) =>
    Promise.resolve(path.includes("/invites") ? json(true, 200, []) : members()),
  ) as unknown as typeof fetch;
}

describe("MembersCard (component)", () => {
  it("lists members", async () => {
    mockFetch(() => json(true, 200, [member]));
    const { container } = renderComponent(<MembersCard />);
    expect(await screen.findByText("ada@example.com")).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it("shows an error state with Retry (not a fake empty) on failure, and recovers", async () => {
    let first = true;
    globalThis.fetch = vi.fn((path: string) => {
      if (path.includes("/invites")) return Promise.resolve(json(true, 200, []));
      if (first) {
        first = false;
        return Promise.resolve(json(false, 500, null));
      }
      return Promise.resolve(json(true, 200, [member]));
    }) as unknown as typeof fetch;
    renderComponent(<MembersCard />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/couldn't load members/i)).toBeTruthy();
    expect(screen.queryByText("No members")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("ada@example.com")).toBeTruthy();
  });
});
