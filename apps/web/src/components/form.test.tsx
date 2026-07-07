// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expectNoA11yViolations, renderComponent } from "../test/component";

import { Field, Select, TextInput } from "./form";

describe("form primitives", () => {
  it("Field associates its label with the control (accessible name)", async () => {
    const { container } = renderComponent(
      <Field label="Cron (5-field, UTC)">
        <TextInput defaultValue="0 3 * * *" />
      </Field>,
    );
    // wrapping <label> gives the input its accessible name
    expect(screen.getByLabelText("Cron (5-field, UTC)")).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it("TextInput emits the token class, appending extra className", () => {
    const { rerender } = renderComponent(<TextInput placeholder="a" />);
    expect(screen.getByPlaceholderText("a").className).toBe("chat-input");
    rerender(<TextInput placeholder="b" className="mono" />);
    expect(screen.getByPlaceholderText("b").className).toBe("chat-input mono");
  });

  it("TextInput forwards native props (value/onChange/maxLength)", () => {
    renderComponent(<TextInput value="x" onChange={() => {}} maxLength={80} aria-label="name" />);
    const el = screen.getByLabelText("name") as HTMLInputElement;
    expect(el.value).toBe("x");
    expect(el.maxLength).toBe(80);
  });

  it("Select emits the token class and forwards value/options", () => {
    renderComponent(
      <Select aria-label="role" value="admin" onChange={() => {}}>
        <option value="admin">admin</option>
        <option value="viewer">viewer</option>
      </Select>,
    );
    const el = screen.getByLabelText("role") as HTMLSelectElement;
    expect(el.className).toBe("role-select");
    expect(el.value).toBe("admin");
  });
});
