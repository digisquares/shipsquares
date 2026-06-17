import { describe, expect, it } from "vitest";

import { makeStubDriver, NotImplementedError } from "./driver.js";

describe("proxy driver abstraction", () => {
  it("a stub satisfies the ProxyDriver contract: ping works, mutators reject", async () => {
    const driver = makeStubDriver("traefik");
    expect(driver.type).toBe("traefik");
    await expect(driver.ping()).resolves.toBe(false);
    await expect(driver.converge({ apps: [], domains: [] })).rejects.toBeInstanceOf(
      NotImplementedError,
    );
    await expect(driver.removeApp("app_1")).rejects.toBeInstanceOf(NotImplementedError);
    await expect(driver.certStates(["x"])).rejects.toBeInstanceOf(NotImplementedError);
  });
});
