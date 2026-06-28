import { describe, expect, it } from "vitest";

import {
  type PgssSnapshot,
  type StatementRow,
  avgPerCall,
  classifyQuery,
  fmtDuration,
  fmtPct,
  overallHitPct,
  previewSql,
  topSharePct,
  windowLabel,
} from "./db-perf";

function row(over: Partial<StatementRow>): StatementRow {
  return {
    rank: 1,
    queryid: "1",
    database: "shop",
    calls: 10,
    totalMs: 100,
    meanMs: 10,
    minMs: 1,
    maxMs: 50,
    stddevMs: 5,
    rows: 10,
    blksHit: 90,
    blksRead: 10,
    hitPct: 90,
    query: "SELECT 1",
    ...over,
  };
}

describe("classifyQuery", () => {
  it("routes by the leading keyword", () => {
    expect(classifyQuery("select * from t")).toBe("SELECT");
    expect(classifyQuery("  INSERT INTO t VALUES ($1)")).toBe("INSERT");
    expect(classifyQuery("update t set a=$1")).toBe("UPDATE");
    expect(classifyQuery("DELETE FROM t")).toBe("DELETE");
    expect(classifyQuery("CREATE INDEX i ON t(a)")).toBe("DDL");
    expect(classifyQuery("BEGIN")).toBe("TRANSACTION");
    expect(classifyQuery("VACUUM ANALYZE")).toBe("UTILITY");
    expect(classifyQuery("<insufficient privilege>")).toBe("OTHER");
    expect(classifyQuery("")).toBe("OTHER");
  });
});

describe("previewSql", () => {
  it("collapses whitespace and truncates", () => {
    expect(previewSql("select\n  a,\n  b\nfrom t")).toBe("select a, b from t");
    expect(previewSql("aaaa", 3)).toBe("aa…");
  });
});

describe("formatters", () => {
  it("fmtDuration adapts units", () => {
    expect(fmtDuration(250)).toBe("250 ms");
    expect(fmtDuration(2500)).toBe("2.50 s");
    expect(fmtDuration(90_000)).toBe("1.5 min");
    expect(fmtDuration(7_200_000)).toBe("2.0 h");
  });
  it("fmtPct guards null/NaN", () => {
    expect(fmtPct(null)).toBe("—");
    expect(fmtPct(Number.NaN)).toBe("—");
    expect(fmtPct(42.34)).toBe("42.3%");
  });
});

describe("derived KPIs", () => {
  const snap: PgssSnapshot = {
    serverId: "dbs_1",
    serverVersion: "17.4",
    statsReset: "2026-06-26T00:00:00.000Z",
    capturedAt: "2026-06-28T04:30:00.000Z",
    totals: { distinctStatements: 3, totalCalls: 100, totalExecMs: 1000 },
    statements: [row({ totalMs: 600 }), row({ rank: 2, totalMs: 400 })],
  };

  it("topSharePct is the #1 statement's share of total DB time", () => {
    expect(topSharePct(snap)).toBe(60);
    expect(topSharePct({ ...snap, statements: [] })).toBe(0);
  });

  it("overallHitPct is the weighted shared-buffer ratio", () => {
    expect(overallHitPct(snap.statements)).toBeCloseTo(90);
    expect(overallHitPct([row({ blksHit: 0, blksRead: 0 })])).toBeNull();
  });

  it("avgPerCall divides total time by calls", () => {
    expect(avgPerCall(snap.totals)).toBe(10);
    expect(avgPerCall({ distinctStatements: 0, totalCalls: 0, totalExecMs: 0 })).toBeNull();
  });

  it("windowLabel renders a compact since-reset window", () => {
    expect(windowLabel(snap.statsReset, snap.capturedAt)).toBe("2d 4h");
    expect(windowLabel(null, snap.capturedAt)).toBe("—");
    expect(windowLabel("2026-06-28T04:00:00.000Z", "2026-06-28T04:30:00.000Z")).toBe("30m");
  });
});
