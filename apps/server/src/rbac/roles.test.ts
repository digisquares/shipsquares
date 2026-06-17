import { describe, expect, it } from "vitest";

import { PERMISSIONS } from "./permissions.js";
import { roleGrants } from "./roles.js";

describe("ROLE_MATRIX / roleGrants", () => {
  it("owner grants every permission", () => {
    for (const p of PERMISSIONS) expect(roleGrants("owner", p)).toBe(true);
  });

  it("admin grants all except org:delete", () => {
    for (const p of PERMISSIONS) expect(roleGrants("admin", p)).toBe(p !== "org:delete");
  });

  it("deployer can deploy + write app/env/secret:read but not member:write/server:write", () => {
    expect(roleGrants("deployer", "deployment:write")).toBe(true);
    expect(roleGrants("deployer", "app:write")).toBe(true);
    expect(roleGrants("deployer", "env:write")).toBe(true);
    expect(roleGrants("deployer", "secret:read")).toBe(true);
    expect(roleGrants("deployer", "member:write")).toBe(false);
    expect(roleGrants("deployer", "server:write")).toBe(false);
    expect(roleGrants("deployer", "org:delete")).toBe(false);
  });

  it("viewer grants only :read and explicitly denies secret:read and every :write", () => {
    for (const p of PERMISSIONS) {
      const expected = p.endsWith(":read") && p !== "secret:read";
      expect(roleGrants("viewer", p)).toBe(expected);
    }
  });

  it("dbstudio: viewer reads, deployer writes but can't connect, admin/owner can connect", () => {
    expect(roleGrants("viewer", "dbstudio:read")).toBe(true);
    expect(roleGrants("viewer", "dbstudio:write")).toBe(false);
    expect(roleGrants("viewer", "dbstudio:connect")).toBe(false);
    expect(roleGrants("deployer", "dbstudio:read")).toBe(true);
    expect(roleGrants("deployer", "dbstudio:write")).toBe(true);
    expect(roleGrants("deployer", "dbstudio:connect")).toBe(false);
    expect(roleGrants("admin", "dbstudio:connect")).toBe(true);
    expect(roleGrants("owner", "dbstudio:connect")).toBe(true);
  });
});
