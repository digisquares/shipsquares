// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations, renderComponent } from "../test/component";

import { ErrorState } from "./error-state";

describe("ErrorState (component)", () => {
  it("announces the failure via role=alert and fires onRetry", async () => {
    const onRetry = vi.fn();
    const { container } = renderComponent(
      <ErrorState
        title="Couldn't load servers"
        message="The server responded 500. Try again in a moment."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Couldn't load servers")).toBeTruthy();
    expect(screen.getByText(/server responded 500/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
    await expectNoA11yViolations(container);
  });

  it("omits the Retry button when no onRetry is given", () => {
    renderComponent(<ErrorState message="boom" />);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });
});
