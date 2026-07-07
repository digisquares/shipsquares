import { describe, expect, it, vi } from "vitest";

import type { Api } from "./api.js";
import { VALUE_FLAGS, parseArgs } from "./args.js";
import { runApps, runDeploy, runLogs, runStatus } from "./commands.js";

function fakeApi(over: Partial<Api> = {}): Api {
  return {
    login: vi.fn(),
    listApps: vi.fn(),
    deploy: vi.fn(),
    getDeployment: vi.fn(),
    listDeployments: vi.fn(),
    appMetrics: vi.fn(),
    appLogs: vi.fn(),
    ...over,
  } as Api;
}

describe("commands", () => {
  it("apps --json prints the raw array", async () => {
    const api = fakeApi({
      listApps: vi
        .fn()
        .mockResolvedValue([
          { id: "app_1", name: "api", repo: null, image: "nginx", branch: "main" },
        ]),
    });
    const r = await runApps(api, parseArgs(["apps", "--json"]));
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.output)[0].name).toBe("api");
  });

  it("status requires an appId", async () => {
    const r = await runStatus(fakeApi(), parseArgs(["status"]));
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain("usage");
  });

  it("deploy without --wait reports the queued id", async () => {
    const api = fakeApi({ deploy: vi.fn().mockResolvedValue({ id: "dpl_9" }) });
    const r = await runDeploy(api, parseArgs(["deploy", "app_1"]));
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain("dpl_9");
  });

  it("deploy --wait fails when the deployment fails", async () => {
    const api = fakeApi({
      deploy: vi.fn().mockResolvedValue({ id: "dpl_9" }),
      getDeployment: vi.fn().mockResolvedValue({
        id: "dpl_9",
        status: "failed",
        trigger: "manual",
        commitAfter: null,
        queuedAt: "",
      }),
    });
    vi.useFakeTimers();
    const p = runDeploy(api, parseArgs(["deploy", "app_1", "--wait"]));
    await vi.runAllTimersAsync();
    const r = await p;
    vi.useRealTimers();
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain("failed");
  });

  it("treats --timeout as a value flag (regression: it was silently dropped)", () => {
    expect(VALUE_FLAGS).toContain("timeout");
    const args = parseArgs(["deploy", "app_1", "--wait", "--timeout", "5"], VALUE_FLAGS);
    expect(args.flags.timeout).toBe("5"); // a value, not boolean `true`
    expect(args.positionals).toEqual(["app_1"]); // "5" isn't a stray positional
  });

  it("deploy --wait honours --timeout as the poll budget", async () => {
    // 5s budget / 2s interval → 2 polls before giving up (vs 300 at the 600s
    // default the bug fell back to). A never-terminating deployment lets us
    // count the polls to confirm the value flowed through.
    const getDeployment = vi.fn().mockResolvedValue({
      id: "dpl_9",
      status: "running",
      trigger: "manual",
      commitAfter: null,
      queuedAt: "",
    });
    const api = fakeApi({ deploy: vi.fn().mockResolvedValue({ id: "dpl_9" }), getDeployment });
    vi.useFakeTimers();
    const p = runDeploy(
      api,
      parseArgs(["deploy", "app_1", "--wait", "--timeout", "5"], VALUE_FLAGS),
    );
    await vi.runAllTimersAsync();
    const r = await p;
    vi.useRealTimers();
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain("timeout");
    expect(getDeployment).toHaveBeenCalledTimes(2);
  });

  it("logs renders newline-joined lines", async () => {
    const api = fakeApi({
      appLogs: vi.fn().mockResolvedValue([
        { stream: "stdout", line: "hello" },
        { stream: "stderr", line: "oops" },
      ]),
    });
    const r = await runLogs(api, parseArgs(["logs", "app_1"], ["tail"]));
    expect(r.output).toBe("hello\noops");
  });
});
