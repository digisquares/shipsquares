import { describe, expect, it } from "vitest";

import { previewCommentBody, previewsToSweep } from "./sweeper.js";

const NOW = new Date("2026-06-11T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const row = (over: Partial<{ id: string; status: string; createdAt: Date }> = {}) => ({
  id: "prev_1",
  status: "running",
  createdAt: hoursAgo(1),
  ...over,
});

describe("previewsToSweep", () => {
  it("selects builds stuck past the build budget", () => {
    const stuck = row({ id: "prev_stuck", status: "building", createdAt: hoursAgo(3) });
    const fresh = row({ id: "prev_fresh", status: "building", createdAt: hoursAgo(1) });
    expect(previewsToSweep([stuck, fresh], NOW).map((r) => r.id)).toEqual(["prev_stuck"]);
  });

  it("selects running previews past the max age, leaves closed/fresh alone", () => {
    const old = row({ id: "prev_old", createdAt: hoursAgo(8 * 24) });
    const recent = row({ id: "prev_recent", createdAt: hoursAgo(24) });
    const closed = row({ id: "prev_closed", status: "closed", createdAt: hoursAgo(30 * 24) });
    expect(previewsToSweep([old, recent, closed], NOW).map((r) => r.id)).toEqual(["prev_old"]);
  });
});

describe("previewCommentBody", () => {
  it("deploy comments link the preview URL", () => {
    const body = previewCommentBody({ kind: "deployed", domain: "pr-7-web.preview.acme.dev" });
    expect(body).toContain("https://pr-7-web.preview.acme.dev");
    expect(body).toContain("Preview");
  });

  it("teardown comments say the environment is gone", () => {
    expect(previewCommentBody({ kind: "closed" })).toContain("torn down");
  });

  it("failure comments do not fabricate a URL", () => {
    const body = previewCommentBody({ kind: "failed" });
    expect(body).not.toContain("https://");
  });
});
