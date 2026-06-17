import { type RenderResult, cleanup, render } from "@testing-library/react";
import axe from "axe-core";
import type { ReactElement } from "react";
import { afterEach, expect } from "vitest";

// The component-test harness (14/20/25): jsdom + Testing Library + axe.
// Import this module from every *.test.tsx — it flags the React act
// environment, registers per-file cleanup, and provides renderComponent +
// expectNoA11yViolations. Color-contrast stays with the dedicated AA suite
// (axe's contrast rule needs a real canvas, which jsdom lacks).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no scrollTo — components auto-scrolling (chat, logs) must not throw.
if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => undefined;
}

afterEach(cleanup);

export function renderComponent(ui: ReactElement): RenderResult {
  return render(ui);
}

export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`),
  ).toEqual([]);
}
