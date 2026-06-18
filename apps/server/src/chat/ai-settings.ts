// AI provider key resolution for the chatbot (22-chatbot-agent.md). Precedence:
// a per-org BYO Claude key (enabled) overrides an optional platform install key;
// with neither, chat is disabled. The key itself is a secret-store reference (11)
// — never plaintext — and is masked for display.

export interface AiSettingsRow {
  enabled: boolean;
  model: string;
  apiKeySecretRef: string | null;
  thinking: boolean;
}

export interface ResolvedAi {
  enabled: boolean;
  model: string;
  keySource: "org" | "platform" | "none";
  keyRef: string | null;
  thinking: boolean;
}

const DEFAULT_MODEL = "claude-sonnet-4-6";

export function resolveAi(org: AiSettingsRow | null, platformKeyRef: string | null): ResolvedAi {
  const thinking = org?.thinking ?? false;
  if (org?.enabled && org.apiKeySecretRef) {
    return {
      enabled: true,
      model: org.model || DEFAULT_MODEL,
      keySource: "org",
      keyRef: org.apiKeySecretRef,
      thinking,
    };
  }
  if (platformKeyRef) {
    return {
      enabled: true,
      model: org?.model || DEFAULT_MODEL,
      keySource: "platform",
      keyRef: platformKeyRef,
      thinking,
    };
  }
  return {
    enabled: false,
    model: org?.model || DEFAULT_MODEL,
    keySource: "none",
    keyRef: null,
    thinking,
  };
}

/** Display hint for a configured key — never the plaintext value. */
export function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
