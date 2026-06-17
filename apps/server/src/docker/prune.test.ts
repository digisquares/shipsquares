import { describe, expect, it } from "vitest";

import { type ImageTag, selectImagesToPrune } from "./prune.js";

const tags: ImageTag[] = [
  { tag: "app:c1", createdAt: 100 },
  { tag: "app:c2", createdAt: 200 },
  { tag: "app:c3", createdAt: 300 },
  { tag: "app:c4", createdAt: 400 },
  { tag: "app:c5", createdAt: 500 },
];

describe("selectImagesToPrune", () => {
  it("keeps the newest N and removes the rest", () => {
    expect(selectImagesToPrune(tags, 2)).toEqual(["app:c3", "app:c2", "app:c1"]);
  });

  it("always keeps the rollback target even if it is old", () => {
    expect(selectImagesToPrune(tags, 2, "app:c1")).toEqual(["app:c3", "app:c2"]);
  });

  it("removes nothing when keep >= count", () => {
    expect(selectImagesToPrune(tags, 10)).toEqual([]);
  });

  it("treats keep <= 0 as keep none (minus rollback target)", () => {
    expect(selectImagesToPrune(tags, 0, "app:c5")).toEqual([
      "app:c4",
      "app:c3",
      "app:c2",
      "app:c1",
    ]);
  });
});
