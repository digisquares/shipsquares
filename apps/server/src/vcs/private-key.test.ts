import { describe, expect, it } from "vitest";

import { normalizePrivateKey } from "./private-key.js";

const PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOg==\n-----END RSA PRIVATE KEY-----";

describe("normalizePrivateKey", () => {
  it("passes a real PEM through untouched", () => {
    expect(normalizePrivateKey(PEM)).toBe(PEM);
  });

  it("decodes a base64-wrapped PEM (systemd EnvironmentFile transport)", () => {
    const b64 = Buffer.from(PEM, "utf8").toString("base64");
    expect(normalizePrivateKey(b64)).toBe(PEM);
  });

  it("unescapes \\n-escaped single-line PEMs (.env transport)", () => {
    const escaped = PEM.replaceAll("\n", "\\n");
    expect(normalizePrivateKey(escaped)).toBe(PEM);
  });

  it("returns non-PEM garbage unchanged (fails loudly downstream)", () => {
    expect(normalizePrivateKey("not-a-key")).toBe("not-a-key");
    expect(normalizePrivateKey("")).toBe("");
  });
});
