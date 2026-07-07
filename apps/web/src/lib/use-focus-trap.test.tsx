// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderComponent } from "../test/component";

import { useFocusTrap } from "./use-focus-trap";

function Dialog() {
  const ref = useFocusTrap<HTMLDivElement>();
  return (
    <div ref={ref} tabIndex={-1} data-testid="dialog">
      <button>first</button>
      <button>last</button>
    </div>
  );
}

function Harness({ open }: { open: boolean }) {
  return (
    <>
      <button data-testid="trigger">trigger</button>
      {open ? <Dialog /> : null}
    </>
  );
}

describe("useFocusTrap", () => {
  it("wraps Tab from last→first and Shift+Tab from first→last", () => {
    renderComponent(<Harness open={true} />);
    const first = screen.getByText("first");
    const last = screen.getByText("last");
    const dialog = screen.getByTestId("dialog");

    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("restores focus to the trigger when the overlay unmounts", () => {
    const { rerender } = renderComponent(<Harness open={false} />);
    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    rerender(<Harness open={true} />); // trap captures the trigger as previously-focused
    screen.getByText("first").focus(); // move focus into the dialog
    expect(document.activeElement).not.toBe(trigger);

    rerender(<Harness open={false} />); // unmount → focus returns to the trigger
    expect(document.activeElement).toBe(trigger);
  });
});
