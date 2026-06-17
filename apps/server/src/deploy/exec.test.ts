import { describe, expect, it } from "vitest";

import { firstStdout, runCommand } from "./exec.js";

// Uses `node` (always present) as a portable stand-in for git/docker.
describe("runCommand", () => {
  it("captures stdout/stderr line-by-line with the exit code", async () => {
    const r = await runCommand("node", [
      "-e",
      "console.log('a');console.log('b');console.error('e')",
    ]);
    expect(r.code).toBe(0);
    expect(r.lines.filter((l) => l.stream === "stdout").map((l) => l.line)).toEqual(["a", "b"]);
    expect(r.lines.some((l) => l.stream === "stderr" && l.line === "e")).toBe(true);
  });

  it("returns the non-zero exit code on failure", async () => {
    const r = await runCommand("node", ["-e", "process.exit(3)"]);
    expect(r.code).toBe(3);
  });

  it("firstStdout returns the first trimmed stdout line", async () => {
    expect(firstStdout(await runCommand("node", ["-e", "console.log('  hi  ')"]))).toBe("hi");
  });

  it("streams each line through onLine as it arrives", async () => {
    const seen: string[] = [];
    await runCommand("node", ["-e", "console.log('x');console.log('y')"], {
      onLine: (_s, line) => seen.push(line),
    });
    expect(seen).toEqual(["x", "y"]);
  });

  it("kills a hung command at timeoutMs and reports timedOut", async () => {
    const r = await runCommand("node", ["-e", "setTimeout(() => {}, 60000)"], { timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(r.code).not.toBe(0);
    expect(r.lines.some((l) => l.stream === "stderr" && l.line.includes("timed out"))).toBe(true);
  }, 15_000);

  it("flushes a final unterminated line (often the real error)", async () => {
    const r = await runCommand("node", ["-e", "process.stdout.write('no-newline')"]);
    expect(r.code).toBe(0);
    expect(r.timedOut).toBeUndefined();
    expect(r.lines).toContainEqual({ stream: "stdout", line: "no-newline" });
  }, 15_000);

  it("kills the child and resolves aborted when the signal fires mid-run", async () => {
    const ac = new AbortController();
    const p = runCommand("node", ["-e", "setInterval(() => {}, 1000)"], { signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    const r = await p;
    expect(r.aborted).toBe(true);
    expect(r.code).not.toBe(0);
  }, 15_000);

  it("returns immediately aborted when the signal is already aborted", async () => {
    const r = await runCommand("node", ["-e", "setInterval(() => {}, 1000)"], {
      signal: AbortSignal.abort(),
    });
    expect(r.aborted).toBe(true);
  }, 15_000);
});
