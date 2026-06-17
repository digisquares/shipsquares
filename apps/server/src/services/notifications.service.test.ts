import { describe, expect, it } from "vitest";

import { channelConfigFor, type DeployPayload, renderBody } from "./notifications.service.js";

const base: DeployPayload = {
  event: "deploy.succeeded",
  app: { id: "app_1", name: "api" },
  deployment: {
    id: "dpl_1",
    status: "succeeded",
    trigger: "push",
    commit: "abcdef1234567890",
    error: null,
  },
  at: "2026-06-08T00:00:00.000Z",
};

describe("notifications renderBody", () => {
  it("slack → { text } with a short commit and the app name", () => {
    const body = JSON.parse(renderBody("slack", "deploy.succeeded", base)) as { text: string };
    expect(body.text).toContain("succeeded");
    expect(body.text).toContain("api");
    expect(body.text).toContain("abcdef1"); // 7-char commit
    expect(body.text).not.toContain("abcdef1234"); // not the full sha
  });

  it("discord → { content }", () => {
    const body = JSON.parse(renderBody("discord", "deploy.succeeded", base)) as { content: string };
    expect(body.content).toContain("succeeded");
  });

  it("a failed event carries the error in the message", () => {
    const failed: DeployPayload = {
      ...base,
      event: "deploy.failed",
      deployment: { ...base.deployment, status: "failed", error: "health check failed" },
    };
    const body = JSON.parse(renderBody("slack", "deploy.failed", failed)) as { text: string };
    expect(body.text).toContain("failed");
    expect(body.text).toContain("health check failed");
  });

  it("generic webhook → the full event payload (not a chat shape)", () => {
    const body = JSON.parse(renderBody("webhook", "deploy.succeeded", base)) as DeployPayload;
    expect(body.event).toBe("deploy.succeeded");
    expect(body.app.name).toBe("api");
    expect(body.deployment.id).toBe("dpl_1");
  });
});

describe("channelConfigFor (per-kind create validation)", () => {
  it("url kinds require a url", () => {
    expect(channelConfigFor("slack", { url: "https://hooks.slack.com/x" })).toEqual({
      url: "https://hooks.slack.com/x",
    });
    expect(() => channelConfigFor("webhook", {})).toThrow(/url/i);
  });

  it("telegram requires botToken + chatId (no url)", () => {
    expect(channelConfigFor("telegram", { botToken: "123:abc", chatId: "42" })).toEqual({
      botToken: "123:abc",
      chatId: "42",
    });
    expect(() => channelConfigFor("telegram", { botToken: "123:abc" })).toThrow(/chatId/i);
    expect(() => channelConfigFor("telegram", { chatId: "42" })).toThrow(/botToken/i);
  });

  it("email requires a recipient", () => {
    expect(channelConfigFor("email", { to: "ops@x.dev" })).toEqual({ to: "ops@x.dev" });
    expect(() => channelConfigFor("email", {})).toThrow(/to/i);
  });

  it("rejects unsupported kinds", () => {
    expect(() => channelConfigFor("pager", { url: "https://x" })).toThrow(/kind/i);
  });
});
