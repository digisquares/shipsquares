import { describe, expect, it } from "vitest";

import { runRemoteCommand } from "./exec.js";
import { generateSshKeyPair } from "./keys.js";

// No sshd in the unit environment — exercise the failure paths offline: a
// refused connection (closed local port) must reject, not hang or leak.
describe("runRemoteCommand", () => {
  it("rejects cleanly when the host is unreachable", async () => {
    const { privateKey } = generateSshKeyPair();
    await expect(
      runRemoteCommand(
        { host: "127.0.0.1", port: 1, username: "x", privateKey, readyTimeoutMs: 2000 },
        "true",
      ),
    ).rejects.toThrow();
  }, 10_000);
});
