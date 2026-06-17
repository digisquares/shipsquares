import { describe, expect, it } from "vitest";

import { toComposeService, toRunFlags } from "./resource-spec.js";

const app = {
  cpuLimit: "1.5",
  cpuReservation: "0.5",
  memLimitBytes: 536870912, // 512Mi
  memReservationBytes: 268435456,
  replicas: 3,
  restartPolicy: "on-failure",
};

describe("toComposeService", () => {
  it("maps limits/reservations/replicas/restart into a compose fragment", () => {
    expect(toComposeService(app)).toEqual({
      restart: "on-failure",
      deploy: {
        replicas: 3,
        resources: {
          limits: { cpus: "1.5", memory: "536870912" },
          reservations: { cpus: "0.5", memory: "268435456" },
        },
      },
    });
  });

  it("omits replicas when it is the default 1 and omits empty resource blocks", () => {
    expect(toComposeService({ replicas: 1, restartPolicy: "unless-stopped" })).toEqual({
      restart: "unless-stopped",
    });
  });

  it("returns an empty fragment for an app with no resource config", () => {
    expect(toComposeService({})).toEqual({});
  });
});

describe("toRunFlags", () => {
  it("emits the equivalent docker run flags", () => {
    expect(toRunFlags(app)).toEqual([
      "--cpus",
      "1.5",
      "--memory",
      "536870912",
      "--memory-reservation",
      "268435456",
      "--restart",
      "on-failure",
    ]);
  });

  it("emits nothing for an empty config", () => {
    expect(toRunFlags({})).toEqual([]);
  });
});
