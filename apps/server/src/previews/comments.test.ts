import { describe, expect, it } from "vitest";

import { prCommentRequest } from "./comments.js";

describe("prCommentRequest", () => {
  it("composes the GitHub issues-comment call for the PR", () => {
    const { url, init } = prCommentRequest("acme/web", 7, "🚀 Preview deployed", "tok_abc");
    expect(url).toBe("https://api.github.com/repos/acme/web/issues/7/comments");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      authorization: "Bearer tok_abc",
      accept: "application/vnd.github+json",
    });
    expect(JSON.parse(init.body)).toEqual({ body: "🚀 Preview deployed" });
  });
});
