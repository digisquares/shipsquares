import { describe, expect, it } from "vitest";

import { formatDotEnv } from "./dotenv.js";

describe("formatDotEnv", () => {
  it("serializes KEY=value lines with a trailing newline", () => {
    const { content, skipped } = formatDotEnv({ PORT: "8080", NODE_ENV: "production" });
    expect(content).toBe("PORT=8080\nNODE_ENV=production\n");
    expect(skipped).toEqual([]);
  });

  it("passes values with spaces, #, quotes and = through literally", () => {
    const { content } = formatDotEnv({ MSG: 'a b #c "d" e=f' });
    expect(content).toBe('MSG=a b #c "d" e=f\n');
  });

  it("skips keys whose value contains a newline (unrepresentable in .env)", () => {
    const { content, skipped } = formatDotEnv({ OK: "1", PEM: "line1\nline2" });
    expect(content).toBe("OK=1\n");
    expect(skipped).toEqual(["PEM"]);
  });

  it("returns empty content for no values", () => {
    expect(formatDotEnv({})).toEqual({ content: "", skipped: [] });
  });
});
