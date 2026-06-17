import { describe, expect, it } from "vitest";

import { defaultTemplateValue, renderEnvFile, resolveTemplateEnv } from "./template-env.js";

// deterministic generator: kind:length → predictable tokens
const gen = (kind: string, length: number) => `${kind.toLowerCase()}${length}`;

describe("resolveTemplateEnv (coolify magic vars)", () => {
  it("generates ONE value per unique password token across both syntaxes", () => {
    const compose = [
      "services:",
      "  db:",
      "    environment:",
      "      - POSTGRES_PASSWORD=${SERVICE_PASSWORD_POSTGRES}",
      "      - ADMIN_PASSWORD=$SERVICE_PASSWORD_POSTGRES",
    ].join("\n");
    const r = resolveTemplateEnv(compose, gen);
    expect(r.env).toEqual({ SERVICE_PASSWORD_POSTGRES: "password32" });
    expect(r.unsupported).toEqual([]);
  });

  it("maps kinds + explicit lengths to the generator", () => {
    const compose = [
      "x: $SERVICE_USER_APP",
      "y: ${SERVICE_HEX_32_SECRET}",
      "z: $SERVICE_BASE64_64_TOKEN",
    ].join("\n");
    const r = resolveTemplateEnv(compose, gen);
    expect(r.env).toEqual({
      SERVICE_USER_APP: "user16",
      SERVICE_HEX_32_SECRET: "hex32",
      SERVICE_BASE64_64_TOKEN: "base6464",
    });
  });

  it("reports FQDN/URL tokens as unsupported instead of fabricating values", () => {
    const r = resolveTemplateEnv("a: $SERVICE_FQDN_WEB\nb: ${SERVICE_URL_API}", gen);
    expect(r.env).toEqual({});
    expect(r.unsupported.sort()).toEqual(["SERVICE_FQDN_WEB", "SERVICE_URL_API"]);
  });

  it("leaves the compose text untouched (values ride the .env file)", () => {
    const compose = "p: ${SERVICE_PASSWORD_X}";
    expect(resolveTemplateEnv(compose, gen).compose).toBe(compose);
  });
});

describe("renderEnvFile", () => {
  it("renders deterministic sorted KEY=value lines with a trailing newline", () => {
    expect(renderEnvFile({ B_KEY: "2", A_KEY: "1" })).toBe("A_KEY=1\nB_KEY=2\n");
    expect(renderEnvFile({})).toBe("");
  });
});

describe("defaultTemplateValue", () => {
  it("mints format-correct values per kind", () => {
    expect(defaultTemplateValue("password", 32)).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(defaultTemplateValue("user", 16)).toMatch(/^[a-z][a-z0-9]{15}$/);
    expect(defaultTemplateValue("hex", 32)).toMatch(/^[0-9a-f]{32}$/);
    expect(defaultTemplateValue("base64", 24)).toHaveLength(24);
    expect(defaultTemplateValue("password", 32)).not.toBe(defaultTemplateValue("password", 32));
  });
});
