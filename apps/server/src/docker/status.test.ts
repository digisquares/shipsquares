import { describe, expect, it } from "vitest";

import { parseComposeStatus } from "./status.js";

describe("parseComposeStatus", () => {
  it("parses the JSON-array shape", () => {
    const raw = JSON.stringify([
      { Service: "web", State: "running" },
      { Service: "db", State: "exited (0)" },
    ]);
    expect(parseComposeStatus(raw)).toEqual({ web: "running", db: "exited" });
  });

  it("parses the NDJSON shape and falls back to Name", () => {
    const raw = ['{"Name":"web","State":"created"}', '{"Service":"worker","State":"dead"}'].join(
      "\n",
    );
    expect(parseComposeStatus(raw)).toEqual({ web: "created", worker: "exited" });
  });

  it("maps unknown states to 'unknown' and empty input to {}", () => {
    expect(parseComposeStatus('[{"Service":"x","State":"restarting"}]')).toEqual({ x: "unknown" });
    expect(parseComposeStatus("   ")).toEqual({});
  });
});
