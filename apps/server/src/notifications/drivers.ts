import nodemailer from "nodemailer";

// Telegram + email notification drivers (30-notifications.md), adapted from
// Dokploy's notifications/utils.ts (Apache-2.0, see NOTICE). Transports are
// injected so every path is unit-testable; results map to {ok, error} — a
// driver never throws into the delivery loop.

interface DeployOutcome {
  event: string;
  app: { name: string };
  deployment: { commit: string | null; error: string | null };
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export function telegramHtml(p: DeployOutcome): string {
  const ok = p.event === "deploy.succeeded";
  const commit = p.deployment.commit ? ` (<code>${p.deployment.commit.slice(0, 7)}</code>)` : "";
  const why = !ok && p.deployment.error ? `\n${p.deployment.error}` : "";
  return `${ok ? "✅" : "❌"} Deploy ${ok ? "succeeded" : "failed"} — <b>${p.app.name}</b>${commit}${why}`;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export type TelegramFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

export async function telegramSend(
  cfg: TelegramConfig,
  text: string,
  fetchFn: TelegramFetch = fetch,
): Promise<SendResult> {
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: "HTML" }),
    });
    // Status only — never echo the request URL (it embeds the bot token).
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function emailContent(p: DeployOutcome): { subject: string; text: string } {
  const ok = p.event === "deploy.succeeded";
  const subject = `${ok ? "✅" : "❌"} Deploy ${ok ? "succeeded" : "failed"} — ${p.app.name}`;
  const lines = [subject];
  if (p.deployment.commit) lines.push(`commit: ${p.deployment.commit.slice(0, 7)}`);
  if (!ok && p.deployment.error) lines.push(`error: ${p.deployment.error}`);
  return { subject, text: lines.join("\n") };
}

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export interface MailTransport {
  sendMail(msg: MailMessage): Promise<unknown>;
}

export async function sendEmail(transport: MailTransport, msg: MailMessage): Promise<SendResult> {
  try {
    await transport.sendMail(msg);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Real SMTP transport from an smtp(s):// URL (nodemailer). */
export function smtpTransport(smtpUrl: string): MailTransport {
  return nodemailer.createTransport(smtpUrl);
}
