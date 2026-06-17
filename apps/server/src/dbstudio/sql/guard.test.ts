import { describe, expect, it } from "vitest";

import { classify, enforceRowLimit, stripNoise } from "./guard.js";

describe("classify", () => {
  it("classifies plain reads", () => {
    expect(classify("select * from users").statementClass).toBe("read");
    expect(classify("EXPLAIN select 1").statementClass).toBe("read");
    expect(classify("show tables").statementClass).toBe("read");
  });

  it("classifies writes and flags missing WHERE / destructiveness", () => {
    expect(classify("insert into t values (1)").statementClass).toBe("write");
    const upd = classify("update t set a = 1");
    expect(upd.statementClass).toBe("write");
    expect(upd.missingWhere).toBe(true);
    expect(upd.destructive).toBe(true);
    expect(classify("update t set a = 1 where id = 1").missingWhere).toBe(false);
    expect(classify("delete from t").destructive).toBe(true);
  });

  it("classifies DDL and marks drop/truncate destructive", () => {
    expect(classify("drop table t").statementClass).toBe("ddl");
    expect(classify("drop table t").destructive).toBe(true);
    expect(classify("truncate t").destructive).toBe(true);
    expect(classify("create table t (id int)").destructive).toBe(false);
  });

  it("treats a data-modifying CTE as a write, a read-only CTE as read", () => {
    expect(classify("with c as (select 1) select * from c").statementClass).toBe("read");
    expect(classify("with c as (select 1) insert into t select * from c").statementClass).toBe(
      "write",
    );
  });

  it("ignores keywords inside string literals and comments", () => {
    expect(classify("select '; drop table t;' as x").statementClass).toBe("read");
    expect(classify("select '; drop table t;' as x").statementCount).toBe(1);
    expect(classify("select 1 -- ; delete from t\n").statementClass).toBe("read");
    expect(classify("select 1 /* ; update t set a=1 */").statementClass).toBe("read");
  });

  it("counts statements (ignoring empty trailing ones) and escalates the batch class", () => {
    expect(classify("select 1; select 2;").statementCount).toBe(2);
    expect(classify("select 1; drop table t").statementClass).toBe("ddl");
    expect(classify("select 1; frobnicate x").statementClass).toBe("unknown");
    expect(classify("   ").statementCount).toBe(0);
  });
});

describe("stripNoise", () => {
  it("blanks comments and string contents but keeps structure", () => {
    expect(stripNoise("select 1 -- drop\n from t").includes("drop")).toBe(false);
    expect(stripNoise("select 'a''b' from t").includes("a")).toBe(false);
  });
});

describe("enforceRowLimit", () => {
  it("appends LIMIT to a bare single SELECT", () => {
    expect(enforceRowLimit("select * from t", 100)).toBe("select * from t LIMIT 100");
    expect(enforceRowLimit("select * from t;", 100)).toBe("select * from t LIMIT 100");
  });
  it("leaves already-limited, multi, non-read, and SHOW/EXPLAIN untouched", () => {
    expect(enforceRowLimit("select * from t limit 5", 100)).toBe("select * from t limit 5");
    expect(enforceRowLimit("select 1; select 2", 100)).toBe("select 1; select 2");
    expect(enforceRowLimit("update t set a=1", 100)).toBe("update t set a=1");
    expect(enforceRowLimit("show tables", 100)).toBe("show tables");
  });
});
