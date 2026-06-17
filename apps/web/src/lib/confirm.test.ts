import { describe, expect, it } from "vitest";

import { normalizeConfirm } from "./confirm";

describe("normalizeConfirm", () => {
  it("fills sensible defaults for a normal confirm", () => {
    const r = normalizeConfirm(1, { title: "Proceed?" });
    expect(r).toMatchObject({
      id: 1,
      title: "Proceed?",
      confirmLabel: "Confirm",
      cancelLabel: "Cancel",
      danger: false,
    });
  });

  it("defaults a danger confirm's label to Delete", () => {
    expect(normalizeConfirm(2, { title: "x", danger: true }).confirmLabel).toBe("Delete");
  });

  it("respects explicit labels and message", () => {
    const r = normalizeConfirm(3, {
      title: "Roll back?",
      message: "Redeploys the selected build.",
      confirmLabel: "Roll back",
      cancelLabel: "Keep current",
    });
    expect(r.confirmLabel).toBe("Roll back");
    expect(r.cancelLabel).toBe("Keep current");
    expect(r.message).toBe("Redeploys the selected build.");
  });
});
