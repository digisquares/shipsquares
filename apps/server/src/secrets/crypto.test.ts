import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { loadMasterKey, open, seal } from "./crypto.js";

describe("secret sealing", () => {
  const key = randomBytes(32);

  it("round-trips plaintext and records the key version", () => {
    const sealed = seal("hunter2", key, 3);
    expect(sealed.keyVersion).toBe(3);
    expect(sealed.ciphertext).not.toContain("hunter2");
    expect(open(sealed, key)).toBe("hunter2");
  });

  it("fails to open a tampered ciphertext", () => {
    const sealed = seal("secret", key, 1);
    const buf = Buffer.from(sealed.ciphertext, "base64");
    buf[buf.length - 1] = (buf[buf.length - 1] ?? 0) ^ 0xff;
    expect(() => open({ ...sealed, ciphertext: buf.toString("base64") }, key)).toThrow(
      /secret decryption failed/,
    );
  });

  it("fails to open with the wrong key", () => {
    const sealed = seal("secret", key, 1);
    expect(() => open(sealed, randomBytes(32))).toThrow(/secret decryption failed/);
  });

  it("loadMasterKey requires a 32-byte base64 key", () => {
    expect(() => loadMasterKey(undefined)).toThrow(/required/);
    expect(() => loadMasterKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
    expect(loadMasterKey(key.toString("base64")).length).toBe(32);
  });
});
