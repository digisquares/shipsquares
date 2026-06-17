import { describe, expect, it } from "vitest";

import { mergeConfig } from "./config.js";

describe("mergeConfig", () => {
  it("prefers env over the saved file", () => {
    const cfg = mergeConfig({ SHIPSQUARES_URL: "https://env.example" } as NodeJS.ProcessEnv, {
      url: "https://file.example",
      cookie: "ss_session=x",
    });
    expect(cfg.url).toBe("https://env.example");
    expect(cfg.cookie).toBe("ss_session=x"); // cookie still comes from the file
  });

  it("falls back to the file URL when env is unset", () => {
    const cfg = mergeConfig({} as NodeJS.ProcessEnv, { url: "https://file.example" });
    expect(cfg.url).toBe("https://file.example");
    expect(cfg.cookie).toBeUndefined();
  });

  it("yields an empty URL when nothing is configured", () => {
    expect(mergeConfig({} as NodeJS.ProcessEnv, null)).toEqual({ url: "" });
  });
});
