import { describe, expect, it } from "vitest";

import { extractResourceId, PARAM_TO_RESOURCE } from "./resource-scope.js";

describe("resource-scope", () => {
  describe("extractResourceId", () => {
    it("extracts id from params", () => {
      const params = { id: "app_123" };
      expect(extractResourceId(params, undefined, "id")).toBe("app_123");
    });

    it("extracts named param from params", () => {
      const params = { appId: "app_456" };
      expect(extractResourceId(params, undefined, "appId")).toBe("app_456");
    });

    it("extracts from body when not in params", () => {
      const params = {};
      const body = { serverId: "srv_789" };
      expect(extractResourceId(params, body, "serverId")).toBe("srv_789");
    });

    it("prefers params over body", () => {
      const params = { serverId: "srv_from_params" };
      const body = { serverId: "srv_from_body" };
      expect(extractResourceId(params, body, "serverId")).toBe("srv_from_params");
    });

    it("returns null when param not present", () => {
      const params = { otherId: "other" };
      expect(extractResourceId(params, undefined, "id")).toBeNull();
    });

    it("returns null for non-string values", () => {
      const params = { id: 123 };
      expect(extractResourceId(params as Record<string, unknown>, undefined, "id")).toBeNull();
    });

    it("returns null for undefined body", () => {
      const params = {};
      expect(extractResourceId(params, undefined, "serverId")).toBeNull();
    });
  });

  describe("PARAM_TO_RESOURCE mapping", () => {
    it("maps common param names to resource types", () => {
      expect(PARAM_TO_RESOURCE["appId"]).toBe("app");
      expect(PARAM_TO_RESOURCE["serverId"]).toBe("server");
      expect(PARAM_TO_RESOURCE["domainId"]).toBe("domain");
      expect(PARAM_TO_RESOURCE["deploymentId"]).toBe("deployment");
      expect(PARAM_TO_RESOURCE["vcsConnectionId"]).toBe("vcsConnection");
      expect(PARAM_TO_RESOURCE["connectionId"]).toBe("dbConnection");
    });

    it("has default id mapping to app", () => {
      expect(PARAM_TO_RESOURCE["id"]).toBe("app");
    });
  });
});
