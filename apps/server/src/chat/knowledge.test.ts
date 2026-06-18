import { describe, expect, it } from "vitest";

import { HELP_DOCS, searchDocs } from "./knowledge.js";

const run = (query: string, limit?: number) =>
  JSON.parse(searchDocs(limit === undefined ? { query } : { query, limit }));

describe("searchDocs", () => {
  it("finds the PITR doc for a how-to query", () => {
    const out = run("how do I set up point-in-time recovery?");
    expect(out.results[0].slug).toBe("backups-and-pitr");
    expect(out.results[0].excerpt.toLowerCase()).toContain("pitr");
  });

  it("matches the bare acronym 'PITR'", () => {
    expect(run("pitr").results[0].slug).toBe("backups-and-pitr");
  });

  it("finds the Docker Hub doc for a deploy query", () => {
    expect(run("deploy from docker hub").results[0].slug).toBe("deploy-from-docker-hub");
  });

  it("finds the custom-domains doc for a TLS question", () => {
    const slugs = run("how does https / tls work for my domain").results.map(
      (r: { slug: string }) => r.slug,
    );
    expect(slugs).toContain("custom-domains-tls");
  });

  it("respects the limit and caps it at 5", () => {
    expect(run("backup database server domain deploy", 2).results.length).toBeLessThanOrEqual(2);
    expect(run("backup database server domain deploy", 99).results.length).toBeLessThanOrEqual(5);
  });

  it("returns the topic list (not a guess) when nothing matches", () => {
    const out = run("zzzqqq nonsense xyzzy");
    expect(out.results).toEqual([]);
    expect(out.topics.map((t: { slug: string }) => t.slug)).toContain("backups-and-pitr");
  });

  it("ranks by relevance — a domain query puts the domains doc first", () => {
    expect(run("custom domain certificate").results[0].slug).toBe("custom-domains-tls");
  });

  it("doc slugs are unique", () => {
    const slugs = HELP_DOCS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
