import { describe, expect, it } from "vitest";

import { addToast, dismissToast, MAX_TOASTS, type Toast } from "./toast";

const t = (id: number): Toast => ({ id, kind: "info", message: `m${id}` });

describe("addToast", () => {
  it("appends a toast", () => {
    expect(addToast([], t(1)).map((x) => x.id)).toEqual([1]);
  });

  it("caps the stack at max, dropping the oldest", () => {
    const full = [t(1), t(2), t(3), t(4)];
    expect(addToast(full, t(5), 4).map((x) => x.id)).toEqual([2, 3, 4, 5]);
  });

  it("defaults to MAX_TOASTS", () => {
    let list: Toast[] = [];
    for (let i = 1; i <= MAX_TOASTS + 3; i += 1) list = addToast(list, t(i));
    expect(list).toHaveLength(MAX_TOASTS);
  });

  it("does not mutate the input array", () => {
    const input = [t(1)];
    addToast(input, t(2));
    expect(input.map((x) => x.id)).toEqual([1]);
  });
});

describe("dismissToast", () => {
  it("removes by id", () => {
    expect(dismissToast([t(1), t(2), t(3)], 2).map((x) => x.id)).toEqual([1, 3]);
  });
  it("is a no-op for an unknown id", () => {
    expect(dismissToast([t(1)], 99).map((x) => x.id)).toEqual([1]);
  });
});
