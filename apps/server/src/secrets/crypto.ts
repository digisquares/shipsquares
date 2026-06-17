import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { SealedValue } from "./types.js";

// Authenticated symmetric sealing for the secret store (11-secrets-config.md).
// AES-256-GCM (Node built-in; no native dep) keyed by a master key loaded from
// SHIPSQUARES_MASTER_KEY — never the database. `keyVersion` enables rotation:
// each row records which key sealed it so the resolver can decrypt mixed
// versions during a re-seal.

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) throw new Error(`master key must be ${KEY_BYTES} bytes`);
}

export function seal(plaintext: string, key: Buffer, keyVersion: number): SealedValue {
  assertKey(key);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([tag, ct]).toString("base64"),
    nonce: nonce.toString("base64"),
    keyVersion,
  };
}

export function open(sealed: SealedValue, key: Buffer): string {
  assertKey(key);
  const data = Buffer.from(sealed.ciphertext, "base64");
  const tag = data.subarray(0, TAG_BYTES);
  const ct = data.subarray(TAG_BYTES);
  const nonce = Buffer.from(sealed.nonce, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("secret decryption failed");
  }
}

/** Load + validate a base64 master key (from SHIPSQUARES_MASTER_KEY at runtime). */
export function loadMasterKey(b64: string | undefined): Buffer {
  if (!b64) throw new Error("SHIPSQUARES_MASTER_KEY is required");
  const key = Buffer.from(b64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`SHIPSQUARES_MASTER_KEY must decode to ${KEY_BYTES} bytes`);
  }
  return key;
}
