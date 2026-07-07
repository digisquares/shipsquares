import { describe, expect, it } from "vitest";

import { redactToolEventForStorage, redactToolEventsForStorage } from "./redact.js";

describe("redactToolEventsForStorage (H4)", () => {
  it("masks set_env values flagged secret, keeps clear config", () => {
    const ev = redactToolEventForStorage({
      tool: "set_env",
      input: {
        appId: "app_1",
        vars: [
          { key: "LOG_LEVEL", value: "info", secret: false },
          { key: "DB_PASSWORD", value: "hunter2", secret: true },
        ],
      },
      result: "ok",
    });
    const vars = ev.input.vars as Array<Record<string, unknown>>;
    expect(vars[0]!.value).toBe("info");
    expect(vars[1]!.value).toBe("***redacted***");
    expect(vars[1]!.key).toBe("DB_PASSWORD"); // the NAME stays; only the value is masked
  });

  it("replaces a create_mailbox result (one-time password) with a placeholder", () => {
    const ev = redactToolEventForStorage({
      tool: "create_mailbox",
      input: { domain: "mail.example.com", localPart: "ada" },
      result: '{"address":"ada@mail.example.com","password":"Xk9!qwer"}',
    });
    expect(ev.result).not.toContain("Xk9!qwer");
    expect(ev.result).toMatch(/one-time secret/i);
  });

  it("masks values under secret-ish keys but keeps opaque *Ref/*Id references", () => {
    const ev = redactToolEventForStorage({
      tool: "some_tool",
      input: { apiKey: "sk-live-abc", passwordSecretRef: "sec_123", appId: "app_1" },
      result: "ok",
    });
    expect(ev.input.apiKey).toBe("***redacted***");
    expect(ev.input.passwordSecretRef).toBe("sec_123");
    expect(ev.input.appId).toBe("app_1");
  });

  it("leaves ordinary events untouched and maps arrays", () => {
    const events = redactToolEventsForStorage([
      { tool: "get_app", input: { appId: "app_1" }, result: "{}" },
    ]);
    expect(events[0]!.input.appId).toBe("app_1");
    expect(events[0]!.result).toBe("{}");
  });
});
