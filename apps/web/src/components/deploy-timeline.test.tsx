// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expectNoA11yViolations, renderComponent } from "../test/component";

import { DeployTimeline } from "./deploy-timeline";

describe("DeployTimeline (component)", () => {
  it("renders the recorded steps with their durations", async () => {
    const { container } = renderComponent(
      <DeployTimeline
        status="running"
        steps={[
          {
            name: "fetch",
            status: "succeeded",
            startedAt: "2026-06-12T10:00:00Z",
            finishedAt: "2026-06-12T10:00:04Z",
          },
          { name: "build", status: "running", startedAt: "2026-06-12T10:00:04Z", finishedAt: null },
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("fetch");
    expect(items[0]?.textContent).toContain("4s");
    expect(items[1]?.textContent).toContain("build");
    await expectNoA11yViolations(container);
  });

  it("falls back to the status lifecycle when no steps are recorded", () => {
    renderComponent(<DeployTimeline status="succeeded" steps={[]} />);
    expect(
      screen
        .getAllByRole("listitem")
        .map((li) => li.textContent ?? "")
        .join(" "),
    ).toMatch(/Queued.*In progress.*Deployed/);
  });
});
