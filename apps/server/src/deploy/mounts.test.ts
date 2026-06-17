import { describe, expect, it } from "vitest";

import { type AppMount, toComposeVolume, toRunVolumeFlag } from "./mounts.js";

describe("mount rendering", () => {
  it("renders a named volume mount", () => {
    const m: AppMount = {
      type: "volume",
      source: "pgdata",
      target: "/var/lib/postgresql",
      readOnly: false,
    };
    expect(toComposeVolume(m)).toBe("pgdata:/var/lib/postgresql");
    expect(toRunVolumeFlag(m)).toBe("-v pgdata:/var/lib/postgresql");
  });

  it("renders a read-only bind mount with :ro", () => {
    const m: AppMount = { type: "bind", source: "/srv/conf", target: "/etc/app", readOnly: true };
    expect(toComposeVolume(m)).toBe("/srv/conf:/etc/app:ro");
  });

  it("renders a file mount from its materialized resolvedSource", () => {
    const m: AppMount = {
      type: "file",
      source: "",
      target: "/etc/app/secret.env",
      readOnly: true,
      resolvedSource: "/tmp/ss-mnt-abc",
    };
    expect(toComposeVolume(m)).toBe("/tmp/ss-mnt-abc:/etc/app/secret.env:ro");
  });

  it("throws if a file mount is rendered before materialization", () => {
    const m: AppMount = { type: "file", source: "", target: "/etc/app/x", readOnly: false };
    expect(() => toComposeVolume(m)).toThrow(/materialized/);
  });
});
