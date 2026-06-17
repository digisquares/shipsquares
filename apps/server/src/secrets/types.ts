// Secret store + resolution contracts (11-secrets-config.md). Values are sealed
// at rest; the app config only ever holds references (names), never plaintext.

export interface SealedValue {
  ciphertext: string; // base64 (authTag ‖ ciphertext)
  nonce: string; // base64
  keyVersion: number; // which master key sealed it (rotation)
}

/** an app's env binding: a clear value OR a reference to a secret name. */
export type EnvBinding =
  | { kind: "clear"; key: string; value: string }
  | { kind: "secret"; key: string; ref: string }; // ref = secret name

export interface ResolvedEnv {
  /** effective process/compose env, secrets dereferenced. */
  values: Record<string, string>;
  /** every secret string value — fed to the redactor, never persisted. */
  redactSet: ReadonlySet<string>;
}
