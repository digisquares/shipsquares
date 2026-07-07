// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations, renderComponent } from "../test/component";

import { Catalog } from "./catalog";

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

const json = (ok: boolean, status: number, body: unknown) =>
  ({ ok, status, json: async () => body }) as Response;

const redis = { slug: "redis", slogan: "In-memory store", category: "database", tags: ["cache"] };

describe("Catalog (component)", () => {
  it("lists templates with an install action", async () => {
    globalThis.fetch = vi.fn((path: string) =>
      Promise.resolve(
        path.startsWith("/api/v1/catalog-services")
          ? json(true, 200, [])
          : json(true, 200, [redis]),
      ),
    ) as unknown as typeof fetch;
    const { container } = renderComponent(<Catalog />);
    expect(await screen.findByText("redis")).toBeTruthy();
    expect(screen.getByRole("button", { name: /install redis/i })).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it("shows an error state with Retry (not a dead-end) when the catalog fails, then recovers", async () => {
    let firstCatalog = true;
    globalThis.fetch = vi.fn((path: string) => {
      if (path.startsWith("/api/v1/catalog-services")) return Promise.resolve(json(true, 200, []));
      if (firstCatalog) {
        firstCatalog = false;
        return Promise.resolve(json(false, 500, null));
      }
      return Promise.resolve(json(true, 200, [redis]));
    }) as unknown as typeof fetch;
    const { container } = renderComponent(<Catalog />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/couldn't load the catalog/i)).toBeTruthy();
    await expectNoA11yViolations(container);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("redis")).toBeTruthy();
  });
});
