import { describe, expect, it } from "vitest";

import type { AuditView } from "../services/audit.service.js";

import { renderActivity } from "./activity.js";

const NOW = Date.parse("2026-06-18T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const ev = (over: Partial<AuditView>): AuditView => ({
  id: "aud_1",
  actorUserId: "usr_1",
  action: "create",
  resourceType: "apps",
  resourceId: null,
  metadata: null,
  createdAt: ago(5 * MIN),
  ...over,
});

describe("renderActivity", () => {
  it("is empty when there's no recent activity", () => {
    expect(renderActivity([], NOW)).toBe("");
  });

  it("renders newest-first with relative times and readable verbs", () => {
    const out = renderActivity(
      [
        ev({
          action: "deployments",
          resourceType: "apps",
          resourceId: "app_1",
          createdAt: ago(3 * MIN),
        }),
        ev({
          action: "create",
          resourceType: "databases",
          resourceId: "db_2",
          createdAt: ago(2 * HOUR),
        }),
        ev({
          action: "delete",
          resourceType: "apps",
          resourceId: "app_9",
          createdAt: ago(1 * DAY),
        }),
      ],
      NOW,
    );
    expect(out).toMatch(/RECENT ACTIVITY/);
    expect(out).toContain("- 3m ago: deployed apps (app_1)");
    expect(out).toContain("- 2h ago: created databases (db_2)");
    expect(out).toContain("- 1d ago: deleted apps (app_9)");
  });

  it("drops activity older than the 7-day window", () => {
    const out = renderActivity([ev({ resourceId: "app_old", createdAt: ago(8 * DAY) })], NOW);
    expect(out).toBe("");
  });

  it("collapses repeats of the same action+resource", () => {
    const out = renderActivity(
      [
        ev({ action: "deployments", resourceId: "app_1", createdAt: ago(1 * MIN) }),
        ev({ action: "deployments", resourceId: "app_1", createdAt: ago(9 * MIN) }),
      ],
      NOW,
    );
    expect(out.match(/deployed apps \(app_1\)/g)).toHaveLength(1);
  });

  it("excludes the chat mechanism's own audit noise", () => {
    const out = renderActivity(
      [
        ev({ action: "approve", resourceType: "chat", createdAt: ago(1 * MIN) }),
        ev({ action: "create", resourceType: "chat", createdAt: ago(2 * MIN) }),
      ],
      NOW,
    );
    expect(out).toBe("");
  });

  it("caps the list at 8 items", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      ev({
        action: "delete",
        resourceType: "apps",
        resourceId: `app_${i}`,
        createdAt: ago(i * MIN + MIN),
      }),
    );
    const lines = renderActivity(events, NOW)
      .split("\n")
      .filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(8);
  });
});
