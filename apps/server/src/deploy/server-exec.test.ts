import { describe, expect, it, vi } from "vitest";

import { resolveServerExecTarget, type ServerRow } from "./server-exec.js";

const worker: ServerRow = {
  host: "4.5.6.7",
  sshPort: 22,
  sshUser: "deploy",
  sshRef: "ref_1",
  role: "worker",
};

describe("resolveServerExecTarget", () => {
  it("returns a local target for null / control / localhost — no key or pool use", async () => {
    const readKey = vi.fn();
    const pool = { exec: vi.fn() };
    expect(await resolveServerExecTarget(null, { readKey, pool })).toMatchObject({
      host: "127.0.0.1",
      remote: false,
    });
    expect(
      await resolveServerExecTarget({ ...worker, role: "control" }, { readKey, pool }),
    ).toMatchObject({ remote: false });
    expect(readKey).not.toHaveBeenCalled();
    expect(pool.exec).not.toHaveBeenCalled();
  });

  it("assembles a pool-backed remote Exec: reads the key, targets the worker, composes the line", async () => {
    const readKey = vi.fn(async () => "PEM-KEY");
    const pool = { exec: vi.fn(async () => ({ code: 0, lines: [] })) };
    const target = await resolveServerExecTarget(worker, { readKey, pool });
    expect(target).toMatchObject({ host: "4.5.6.7", remote: true });

    await target.exec("docker", ["ps", "-a"], { cwd: "/srv/builds/d1" });
    expect(readKey).toHaveBeenCalledWith("ref_1");
    expect(pool.exec).toHaveBeenCalledWith(
      { host: "4.5.6.7", port: 22, username: "deploy", privateKey: "PEM-KEY" },
      "cd '/srv/builds/d1' && 'docker' 'ps' '-a'",
      {},
    );
  });

  it("forwards onLine + timeout to the pool exec", async () => {
    const pool = { exec: vi.fn(async () => ({ code: 0, lines: [] })) };
    const onLine = vi.fn();
    const target = await resolveServerExecTarget(worker, { readKey: async () => "k", pool });
    await target.exec("git", ["clone", "u"], { onLine, timeoutMs: 9000 });
    expect(pool.exec).toHaveBeenCalledWith(expect.anything(), "'git' 'clone' 'u'", {
      onLine,
      timeoutMs: 9000,
    });
  });
});
