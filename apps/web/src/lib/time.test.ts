import { describe, expect, it } from "vitest";

import { relativeTime } from "./time";

const NOW = Date.parse("2026-06-09T12:00:00Z");
const ago = (sec: number) => new Date(NOW - sec * 1000).toISOString();

describe("relativeTime", () => {
  it("collapses the last 45s to 'just now'", () => {
    expect(relativeTime(ago(10), NOW)).toBe("just now");
  });

  it("formats minutes / hours / days ago", () => {
    expect(relativeTime(ago(120), NOW)).toBe("2 min ago");
    expect(relativeTime(ago(3600), NOW)).toBe("1h ago");
    expect(relativeTime(ago(2 * 86400), NOW)).toBe("2d ago");
  });

  it("formats months and years", () => {
    expect(relativeTime(ago(60 * 86400), NOW)).toBe("2mo ago");
    expect(relativeTime(ago(400 * 86400), NOW)).toBe("1y ago");
  });

  it("handles future times", () => {
    expect(relativeTime(ago(-120), NOW)).toBe("in 2 min");
  });

  it("returns '' for an invalid date", () => {
    expect(relativeTime("not-a-date", NOW)).toBe("");
  });
});
