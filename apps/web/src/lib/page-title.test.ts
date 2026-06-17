import { describe, expect, it } from "vitest";

import { pageTitle } from "./page-title";

describe("pageTitle", () => {
  it("returns the bare app name with no segments", () => {
    expect(pageTitle()).toBe("ShipSquares");
  });

  it("suffixes a single segment", () => {
    expect(pageTitle("Dashboard")).toBe("Dashboard — ShipSquares");
  });

  it("joins multiple segments with a middot", () => {
    expect(pageTitle("web", "Deployments")).toBe("web · Deployments — ShipSquares");
  });

  it("drops empty/whitespace segments", () => {
    expect(pageTitle("", "  ", "web")).toBe("web — ShipSquares");
  });
});
