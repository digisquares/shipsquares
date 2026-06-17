import { describe, expect, it } from "vitest";

import { buildWebhookSpec } from "./webhook-spec.js";

describe("buildWebhookSpec", () => {
  it("targets the /hooks/:id ingest route with a push event", () => {
    expect(buildWebhookSpec("https://ctrl.example.com", "ihk_123", "s3cr3t")).toEqual({
      ingestUrl: "https://ctrl.example.com/hooks/ihk_123",
      secret: "s3cr3t",
      events: ["push"],
    });
  });

  it("strips a trailing slash from the control base url", () => {
    expect(buildWebhookSpec("https://ctrl.example.com/", "ihk_1", "s").ingestUrl).toBe(
      "https://ctrl.example.com/hooks/ihk_1",
    );
  });

  it("only subscribes to push", () => {
    expect(buildWebhookSpec("https://c", "w", "s").events).toEqual(["push"]);
  });
});
