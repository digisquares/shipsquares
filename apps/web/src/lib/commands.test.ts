import { describe, expect, it } from "vitest";

import { type Command, fuzzyScore, paletteResults, rankCommands } from "./commands";

const cmd = (id: string, title: string, keywords?: string[]): Command => ({
  id,
  title,
  group: "g",
  keywords,
  run: () => {},
});

describe("fuzzyScore", () => {
  it("ranks exact > prefix > subsequence", () => {
    const exact = fuzzyScore("dash", "dash");
    const prefix = fuzzyScore("dash", "dashboard");
    const sub = fuzzyScore("dsh", "dashboard");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(0);
  });

  it("returns a negative score when the query is not a subsequence", () => {
    expect(fuzzyScore("xqz", "dashboard")).toBeLessThan(0);
  });

  it("treats an empty query as neutral (matches anything)", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("DASH", "Dashboard")).toBeGreaterThan(0);
  });
});

describe("rankCommands", () => {
  it("filters out non-matches", () => {
    const cmds = [cmd("set", "Settings"), cmd("srv", "Servers"), cmd("out", "Sign out")];
    const ids = rankCommands(cmds, "se").map((c) => c.id);
    expect(ids).toContain("set");
    expect(ids).toContain("srv");
    expect(ids).not.toContain("out");
  });

  it("ranks an exact title match first", () => {
    const cmds = [cmd("a", "Dashboard apps"), cmd("b", "Apps")];
    expect(rankCommands(cmds, "apps")[0]?.id).toBe("b");
  });

  it("matches via keywords", () => {
    const cmds = [cmd("logout", "Sign out", ["logout", "exit"])];
    expect(rankCommands(cmds, "logout").map((c) => c.id)).toEqual(["logout"]);
  });

  it("returns all commands in declaration order for an empty query", () => {
    const cmds = [cmd("a", "Alpha"), cmd("b", "Bravo")];
    expect(rankCommands(cmds, "").map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("paletteResults", () => {
  it("offers ask-the-assistant only for an unmatched, non-empty query", () => {
    const cmds = [cmd("d", "Dashboard")];
    expect(paletteResults(cmds, "zzqqxx").askAssistant).toBe(true);
    expect(paletteResults(cmds, "dash").askAssistant).toBe(false);
    expect(paletteResults(cmds, "").askAssistant).toBe(false);
  });
});
