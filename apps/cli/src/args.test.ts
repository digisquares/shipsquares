import { describe, expect, it } from "vitest";

import { parseArgs } from "./args.js";

describe("parseArgs", () => {
  it("defaults to the help command on empty argv", () => {
    expect(parseArgs([])).toEqual({ command: "help", positionals: [], flags: {} });
  });

  it("splits command, positionals, and boolean flags", () => {
    const r = parseArgs(["deploy", "app_1", "--wait", "--json"]);
    expect(r.command).toBe("deploy");
    expect(r.positionals).toEqual(["app_1"]);
    expect(r.flags).toEqual({ wait: true, json: true });
  });

  it("consumes a value only for declared value-flags", () => {
    const r = parseArgs(["logs", "app_1", "--tail", "50", "--json"], ["tail"]);
    expect(r.positionals).toEqual(["app_1"]);
    expect(r.flags.tail).toBe("50");
    expect(r.flags.json).toBe(true);
  });

  it("does not let a boolean flag swallow the following positional", () => {
    const r = parseArgs(["deploy", "--wait", "app_1"], ["url", "tail"]);
    expect(r.flags.wait).toBe(true);
    expect(r.positionals).toEqual(["app_1"]);
  });

  it("parses the --key=value inline form for a value flag", () => {
    const r = parseArgs(["logs", "app_1", "--tail=100", "--json"], ["tail"]);
    expect(r.flags.tail).toBe("100");
    expect(r.flags.json).toBe(true);
    expect(r.positionals).toEqual(["app_1"]);
  });

  it("parses --key=value even for a flag not declared as a value flag", () => {
    const r = parseArgs(["deploy", "app_1", "--branch=main"], []);
    expect(r.flags.branch).toBe("main");
  });

  it("does not let a value flag swallow a following flag (missing value → empty)", () => {
    const r = parseArgs(["logs", "app_1", "--tail", "--json"], ["tail"]);
    expect(r.flags.tail).toBe(""); // no value consumed
    expect(r.flags.json).toBe(true); // --json preserved
  });

  it("a value flag at the end of argv with no value is empty, not the next-undefined", () => {
    const r = parseArgs(["logs", "app_1", "--tail"], ["tail"]);
    expect(r.flags.tail).toBe("");
  });
});
