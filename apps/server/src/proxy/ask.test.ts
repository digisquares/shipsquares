import { describe, expect, it } from "vitest";

import { answerAsk } from "./ask.js";

const statuses: Record<string, string> = {
  "app.acme.com": "verified",
  "new.acme.com": "pending",
  "old.acme.com": "issued",
  "bad.acme.com": "error",
};
const statusOf = (fqdn: string): string | undefined => statuses[fqdn];

describe("answerAsk", () => {
  it("allows verified and pending fqdns (200)", () => {
    expect(answerAsk("app.acme.com", statusOf)).toEqual({ allow: true, status: 200 });
    expect(answerAsk("new.acme.com", statusOf)).toEqual({ allow: true, status: 200 });
  });

  it("denies unknown, errored, and already-issued fqdns (403)", () => {
    expect(answerAsk("evil.example.com", statusOf)).toEqual({ allow: false, status: 403 });
    expect(answerAsk("bad.acme.com", statusOf)).toEqual({ allow: false, status: 403 });
    expect(answerAsk("old.acme.com", statusOf)).toEqual({ allow: false, status: 403 });
  });
});
