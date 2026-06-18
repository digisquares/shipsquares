import { describe, expect, it } from "vitest";

import { maskKey, resolveAi } from "./ai-settings.js";

describe("resolveAi", () => {
  it("prefers an enabled org BYO key", () => {
    expect(
      resolveAi(
        { enabled: true, model: "claude-opus-4-8", apiKeySecretRef: "sec_org", thinking: true },
        "sec_platform",
      ),
    ).toEqual({
      enabled: true,
      model: "claude-opus-4-8",
      keySource: "org",
      keyRef: "sec_org",
      thinking: true, // opt-in thinking propagates from the org row
    });
  });

  it("falls back to the platform key when the org has none or is disabled", () => {
    expect(resolveAi(null, "sec_platform").keySource).toBe("platform");
    expect(
      resolveAi(
        { enabled: false, model: "m", apiKeySecretRef: "sec_org", thinking: false },
        "sec_platform",
      ).keySource,
    ).toBe("platform");
  });

  it("is disabled when neither key is configured", () => {
    expect(resolveAi(null, null)).toMatchObject({
      enabled: false,
      keySource: "none",
      keyRef: null,
    });
  });
});

describe("maskKey", () => {
  it("never reveals the middle of a key", () => {
    expect(maskKey("sk-ant-abcdefghijklmnop")).toBe("sk-ant…mnop");
    expect(maskKey("short")).toBe("****");
  });
});
