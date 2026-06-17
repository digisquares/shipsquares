import { describe, expect, it } from "vitest";

import { buildConnectionString } from "./connection.js";

describe("buildConnectionString", () => {
  it("assembles an sslmode=require URL with the default port", () => {
    expect(
      buildConnectionString({ user: "app", password: "pw", host: "db.internal", database: "app" }),
    ).toBe("postgres://app:pw@db.internal:5432/app?sslmode=require");
  });

  it("URL-encodes a password with special characters", () => {
    const url = buildConnectionString({
      user: "app",
      password: "p@ss:w/d",
      host: "h",
      database: "d",
    });
    expect(url).toContain("p%40ss%3Aw%2Fd");
    expect(url).not.toContain("p@ss:w/d");
  });

  it("honours a custom port and ssl=false", () => {
    expect(
      buildConnectionString({
        user: "u",
        password: "p",
        host: "h",
        port: 6432,
        database: "d",
        ssl: false,
      }),
    ).toBe("postgres://u:p@h:6432/d");
  });
});
