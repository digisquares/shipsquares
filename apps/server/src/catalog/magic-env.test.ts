import { describe, expect, it } from "vitest";

import { parameterizeTemplate } from "./magic-env.js";

const random = (n: number) => "x".repeat(n);

describe("parameterizeTemplate (catalog magic env vars)", () => {
  it("generates and substitutes password/user/fqdn tokens", () => {
    const template = [
      "DB_PASSWORD=$SERVICE_PASSWORD_DB",
      "ADMIN=$SERVICE_USER_ADMIN",
      "FQDN=${SERVICE_FQDN_APP}",
    ].join("\n");
    const { rendered, generated } = parameterizeTemplate(template, {
      appDomain: "preview.acme.com",
      random,
    });
    expect(generated.SERVICE_PASSWORD_DB).toBe("x".repeat(32));
    expect(generated.SERVICE_USER_ADMIN).toBe("user-xxxxxxxx");
    expect(generated.SERVICE_FQDN_APP).toBe("app.preview.acme.com");
    expect(rendered).toContain(`DB_PASSWORD=${"x".repeat(32)}`);
    expect(rendered).toContain("FQDN=app.preview.acme.com");
  });

  it("distinguishes PASSWORD_64 from PASSWORD", () => {
    const { generated } = parameterizeTemplate("$SERVICE_PASSWORD_64_KEY", { random });
    expect(generated.SERVICE_PASSWORD_64_KEY).toBe("x".repeat(64));
  });

  it("reuses one generated value for repeated tokens", () => {
    const { rendered } = parameterizeTemplate("A=$SERVICE_PASSWORD_DB B=$SERVICE_PASSWORD_DB", {
      random,
    });
    const [a, b] = rendered.replace("A=", "").replace("B=", "").split(" ");
    expect(a).toBe(b);
  });

  it("leaves non-magic text untouched", () => {
    expect(parameterizeTemplate("PORT=3000\nNAME=plain").rendered).toBe("PORT=3000\nNAME=plain");
  });
});
