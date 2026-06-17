import { describe, expect, it } from "vitest";

import { toDatabaseView, toServerView } from "./databases.service.js";

const serverRow = {
  id: "dbs_1",
  organizationId: "org_1",
  engine: "postgres" as const,
  host: "10.0.0.5",
  port: 5432,
  adminSecretRef: "SEALED_ADMIN_URL",
  isDefault: true,
  tls: true,
  createdAt: new Date("2026-06-10T12:00:00Z"),
};

const dbRow = {
  id: "db_1",
  serverId: "dbs_1",
  organizationId: "org_1",
  name: "shop",
  ownerRole: "shop_app",
  appId: "app_1",
  createdAt: new Date("2026-06-10T12:00:00Z"),
};

describe("databases views", () => {
  it("server view NEVER exposes the sealed admin credentials", () => {
    const view = toServerView(serverRow);
    expect(view).toEqual({
      id: "dbs_1",
      engine: "postgres",
      host: "10.0.0.5",
      port: 5432,
      isDefault: true,
      tls: true,
      createdAt: "2026-06-10T12:00:00.000Z",
    });
    expect(JSON.stringify(view)).not.toContain("SEALED_ADMIN_URL");
    expect(JSON.stringify(view)).not.toContain("organizationId");
  });

  it("database view carries ownership but no secrets", () => {
    expect(toDatabaseView(dbRow)).toEqual({
      id: "db_1",
      serverId: "dbs_1",
      name: "shop",
      ownerRole: "shop_app",
      appId: "app_1",
      createdAt: "2026-06-10T12:00:00.000Z",
    });
  });
});
