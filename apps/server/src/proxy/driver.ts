import type { CertState, DesiredApp, DesiredDomain, ProxyDriver, ProxyType } from "./types.js";

// The traefik/nginx drivers are interface-only stubs (Phase 7): they satisfy the
// ProxyDriver contract for `ping` but throw on mutators, proving the abstraction
// is real (PROXY_DRIVER can be swapped without import errors). The caddy driver's
// real implementation wraps the admin-API client (runtime).

export class NotImplementedError extends Error {
  constructor(type: ProxyType) {
    super(`${type} proxy driver is not implemented`);
    this.name = "NotImplementedError";
  }
}

export function makeStubDriver(type: ProxyType): ProxyDriver {
  return {
    type,
    async converge(): Promise<void> {
      throw new NotImplementedError(type);
    },
    async upsertApp(_app: DesiredApp, _domains: DesiredDomain[]): Promise<void> {
      throw new NotImplementedError(type);
    },
    async removeApp(_appId: string): Promise<void> {
      throw new NotImplementedError(type);
    },
    async certStates(_fqdns: string[]): Promise<CertState[]> {
      throw new NotImplementedError(type);
    },
    async ping(): Promise<boolean> {
      return false;
    },
  };
}
