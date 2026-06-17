import { randomBytes } from "node:crypto";

// Coolify magic-env resolution (17-catalog-accessories.md), adapted from
// coolify's shared service-template parsing (Apache-2.0, see NOTICE): catalog
// composes reference `$SERVICE_<KIND>[_<LEN>]_<NAME>` tokens that the platform
// must mint at install time. Values ride the compose project's .env file —
// the compose TEXT is never rewritten (re-runs reuse the same .env). FQDN/URL
// kinds need domain wiring and are reported, never fabricated.

export type TemplateValueGenerator = (
  kind: "password" | "user" | "hex" | "base64" | "realbase64",
  length: number,
) => string;

export interface ResolvedTemplateEnv {
  compose: string;
  /** token name → generated value (one per unique token) */
  env: Record<string, string>;
  /** tokens the platform cannot mint yet (SERVICE_FQDN_*, SERVICE_URL_*) */
  unsupported: string[];
}

/** Crypto-backed default generator: alphanumeric passwords, lowercase users
 *  (leading letter — DB engines reject digit-led roles), hex, and base64
 *  trimmed to the requested length. */
export function defaultTemplateValue(
  kind: Parameters<TemplateValueGenerator>[0],
  length: number,
): string {
  const alnum = (chars: string, n: number): string => {
    let out = "";
    const bytes = randomBytes(n * 2);
    for (let i = 0; out.length < n && i < bytes.length; i += 1) {
      out += chars[bytes[i]! % chars.length];
    }
    return out;
  };
  if (kind === "hex")
    return randomBytes(Math.ceil(length / 2))
      .toString("hex")
      .slice(0, length);
  if (kind === "base64" || kind === "realbase64") {
    return randomBytes(length).toString("base64").replaceAll(/[+/=]/g, "A").slice(0, length);
  }
  if (kind === "user") {
    return (
      alnum("abcdefghijklmnopqrstuvwxyz", 1) +
      alnum("abcdefghijklmnopqrstuvwxyz0123456789", length - 1)
    );
  }
  return alnum("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", length);
}

/** The compose project's .env content — deterministic for diffing/re-runs. */
export function renderEnvFile(env: Record<string, string>): string {
  const keys = Object.keys(env).sort();
  return keys.length === 0 ? "" : `${keys.map((k) => `${k}=${env[k]}`).join("\n")}\n`;
}

const TOKEN = /\$\{?(SERVICE_[A-Z0-9_]+?)\}?(?![A-Z0-9_])/g;

const KIND_DEFAULTS: Record<
  string,
  { kind: Parameters<TemplateValueGenerator>[0]; length: number }
> = {
  PASSWORD: { kind: "password", length: 32 },
  USER: { kind: "user", length: 16 },
  HEX: { kind: "hex", length: 32 },
  BASE64: { kind: "base64", length: 32 },
  REALBASE64: { kind: "realbase64", length: 32 },
};

export function resolveTemplateEnv(
  compose: string,
  generate: TemplateValueGenerator,
): ResolvedTemplateEnv {
  const env: Record<string, string> = {};
  const unsupported = new Set<string>();

  for (const match of compose.matchAll(TOKEN)) {
    const token = match[1]!;
    if (token in env || unsupported.has(token)) continue;

    // SERVICE_<KIND>[_<LEN>]_<NAME>
    const parts = token.split("_");
    const kindWord = parts[1] ?? "";
    if (kindWord === "FQDN" || kindWord === "URL") {
      unsupported.add(token);
      continue;
    }
    const spec = KIND_DEFAULTS[kindWord];
    if (!spec) continue; // plain $SERVICE_FOO without a known kind — leave to compose
    const maybeLen = Number(parts[2]);
    const length = Number.isInteger(maybeLen) && maybeLen > 0 ? maybeLen : spec.length;
    env[token] = generate(spec.kind, length);
  }
  return { compose, env, unsupported: [...unsupported] };
}
