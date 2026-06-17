import { describe, expect, it, vi } from "vitest";

import {
  emailContent,
  sendEmail,
  type TelegramFetch,
  telegramHtml,
  telegramSend,
} from "./drivers.js";

const failed = {
  event: "deploy.failed",
  app: { name: "api" },
  deployment: { commit: "abcdef1234", error: "boom" },
};
const succeeded = {
  event: "deploy.succeeded",
  app: { name: "api" },
  deployment: { commit: "abcdef1234", error: null },
};

describe("telegramHtml", () => {
  it("renders a failed deploy with app, short commit, and error", () => {
    const html = telegramHtml(failed);
    expect(html).toContain("❌");
    expect(html).toContain("<b>api</b>");
    expect(html).toContain("abcdef1");
    expect(html).toContain("boom");
  });

  it("renders a success without an error suffix", () => {
    const html = telegramHtml(succeeded);
    expect(html).toContain("✅");
    expect(html).not.toContain("boom");
  });
});

describe("telegramSend", () => {
  const cfg = { botToken: "123:SECRETTOKEN", chatId: "42" };

  it("POSTs sendMessage with chat_id + HTML parse mode", async () => {
    const fetchFn = vi.fn<TelegramFetch>(async () => ({ ok: true, status: 200 }));
    const r = await telegramSend(cfg, "<b>hi</b>", fetchFn);
    expect(r.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bot123:SECRETTOKEN/sendMessage");
    expect(JSON.parse(init.body)).toEqual({ chat_id: "42", text: "<b>hi</b>", parse_mode: "HTML" });
  });

  it("maps failures without leaking the bot token", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 404 }));
    const r = await telegramSend(cfg, "x", fetchFn);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("HTTP 404");
    expect(r.error).not.toContain("SECRETTOKEN");
  });
});

describe("emailContent", () => {
  it("builds subject + text for both outcomes", () => {
    const fail = emailContent(failed);
    expect(fail.subject).toBe("❌ Deploy failed — api");
    expect(fail.text).toContain("abcdef1");
    expect(fail.text).toContain("boom");
    expect(emailContent(succeeded).subject).toBe("✅ Deploy succeeded — api");
  });
});

describe("sendEmail", () => {
  const msg = { from: "ship@x.dev", to: "ops@x.dev", subject: "s", text: "t" };

  it("sends through the injected transport", async () => {
    const transport = { sendMail: vi.fn(async () => ({})) };
    expect(await sendEmail(transport, msg)).toEqual({ ok: true });
    expect(transport.sendMail).toHaveBeenCalledWith(msg);
  });

  it("maps transport failures to ok:false", async () => {
    const transport = {
      sendMail: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    };
    const r = await sendEmail(transport, msg);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("ECONNREFUSED");
  });
});
