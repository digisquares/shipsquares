import { randomBytes } from "node:crypto";

// One-click catalog template parametrization (17-catalog-accessories.md).
// Implements Coolify's "magic env var" concept (app/.../shared.php
// get_service_templates + the SERVICE_* replacer): a compose template references
// `$SERVICE_PASSWORD_DB`, `$SERVICE_FQDN_APP`, etc.; on install we generate a
// value once per unique token, substitute every occurrence, and return the
// generated env. The RNG is injectable so this is deterministic + testable.

export type RandomFn = (chars: number) => string;

const defaultRandom: RandomFn = (chars) =>
  randomBytes(Math.ceil(chars / 2))
    .toString("hex")
    .slice(0, chars);

// PASSWORD_64 / BASE64_64 must precede PASSWORD / BASE64 in the alternation.
const MAGIC = /\$\{?SERVICE_(FQDN|URL|PASSWORD_64|PASSWORD|USER|BASE64_64|BASE64)_([A-Z0-9]+)\}?/g;

export interface MagicEnvOptions {
  /** base domain for FQDN/URL magic vars (e.g. an app's wildcard domain). */
  appDomain?: string;
  random?: RandomFn;
}

export interface MagicEnvResult {
  rendered: string;
  /** token name (e.g. "SERVICE_PASSWORD_DB") -> generated value. */
  generated: Record<string, string>;
}

function generateValue(kind: string, name: string, opts: MagicEnvOptions): string {
  const random = opts.random ?? defaultRandom;
  const domain = opts.appDomain ?? "example.com";
  const slug = name.toLowerCase();
  switch (kind) {
    case "FQDN":
      return `${slug}.${domain}`;
    case "URL":
      return `https://${slug}.${domain}`;
    case "PASSWORD":
      return random(32);
    case "PASSWORD_64":
      return random(64);
    case "USER":
      return `user-${random(8)}`;
    case "BASE64":
      return Buffer.from(random(24)).toString("base64");
    case "BASE64_64":
      return Buffer.from(random(48)).toString("base64");
    default:
      return random(16);
  }
}

export function parameterizeTemplate(template: string, opts: MagicEnvOptions = {}): MagicEnvResult {
  const generated: Record<string, string> = {};
  const rendered = template.replace(MAGIC, (_match, kind: string, name: string) => {
    const key = `SERVICE_${kind}_${name}`;
    const existing = generated[key];
    if (existing !== undefined) return existing;
    const value = generateValue(kind, name, opts);
    generated[key] = value;
    return value;
  });
  return { rendered, generated };
}
