import { describe, expect, it } from "vitest";

import { type BackupRecord, selectBackupsToPrune } from "./retention.js";

const DAY = 86_400_000;
const now = 100 * DAY;

const backups: BackupRecord[] = [
  { id: "b1", createdAt: now - 1 * DAY },
  { id: "b2", createdAt: now - 5 * DAY },
  { id: "b3", createdAt: now - 20 * DAY },
  { id: "b4", createdAt: now - 40 * DAY },
];

describe("selectBackupsToPrune", () => {
  it("keeps the newest keepCount and prunes the rest when retention is short", () => {
    // keep 2 newest (b1,b2); retention 0 → prune b3,b4
    expect(selectBackupsToPrune(backups, 2, 0, now)).toEqual(["b3", "b4"]);
  });

  it("also keeps anything inside the retention window", () => {
    // keep 1 newest (b1) + anything within 21 days (b1,b2,b3) → prune only b4
    expect(selectBackupsToPrune(backups, 1, 21 * DAY, now)).toEqual(["b4"]);
  });

  it("prunes nothing when keepCount covers everything", () => {
    expect(selectBackupsToPrune(backups, 10, 0, now)).toEqual([]);
  });
});
