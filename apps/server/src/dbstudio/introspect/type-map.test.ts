import { describe, expect, it } from "vitest";

import { mysqlUiType, pgUiType, uiTypeFor } from "./type-map.js";

describe("pgUiType", () => {
  it("maps the common Postgres information_schema data_type strings", () => {
    expect(pgUiType("integer")).toBe("number");
    expect(pgUiType("bigint")).toBe("number");
    expect(pgUiType("numeric")).toBe("number");
    expect(pgUiType("double precision")).toBe("number");
    expect(pgUiType("boolean")).toBe("boolean");
    expect(pgUiType("character varying")).toBe("string");
    expect(pgUiType("text")).toBe("string");
    expect(pgUiType("timestamp with time zone")).toBe("datetime");
    expect(pgUiType("date")).toBe("datetime");
    expect(pgUiType("jsonb")).toBe("json");
    expect(pgUiType("uuid")).toBe("uuid");
    expect(pgUiType("bytea")).toBe("bytes");
    expect(pgUiType("USER-DEFINED")).toBe("enum");
    expect(pgUiType("ARRAY")).toBe("other");
  });
});

describe("mysqlUiType", () => {
  it("maps the common MySQL column_type strings", () => {
    expect(mysqlUiType("int(11)")).toBe("number");
    expect(mysqlUiType("bigint unsigned")).toBe("number");
    expect(mysqlUiType("decimal(10,2)")).toBe("number");
    expect(mysqlUiType("tinyint(1)")).toBe("boolean"); // the MySQL bool idiom
    expect(mysqlUiType("tinyint(4)")).toBe("number");
    expect(mysqlUiType("varchar(255)")).toBe("string");
    expect(mysqlUiType("text")).toBe("string");
    expect(mysqlUiType("datetime")).toBe("datetime");
    expect(mysqlUiType("json")).toBe("json");
    expect(mysqlUiType("enum('a','b')")).toBe("enum");
    expect(mysqlUiType("blob")).toBe("bytes");
  });
});

describe("uiTypeFor", () => {
  it("dispatches by engine", () => {
    expect(uiTypeFor("postgres", "jsonb")).toBe("json");
    expect(uiTypeFor("mysql", "tinyint(1)")).toBe("boolean");
  });
});
