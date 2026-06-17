import { EventEmitter } from "node:events";

// In-process pub/sub for live deployment logs + status (12-realtime-logs.md).
// The executor publishes each persisted log line + status transition; WS
// clients subscribe. Multi-instance fan-out rides the optional pg-bridge
// (R2.4): publishes are forwarded over NOTIFY, and frames from OTHER
// processes re-enter through injectRemote* (emit-only — never re-forwarded,
// so no loops).
export interface LogFrame {
  seq: number;
  stream: string;
  line: string;
  at: string;
}

type Forwarder = (
  event:
    | { kind: "log"; deploymentId: string; frame: LogFrame }
    | { kind: "status"; deploymentId: string; status: string },
) => void;

class DeploymentLogBus {
  private readonly emitter = new EventEmitter();
  private forwarder: Forwarder | null = null;

  constructor() {
    this.emitter.setMaxListeners(0); // many concurrent WS subscribers
  }

  /** The pg-bridge's hook; null detaches it. */
  setForwarder(fn: Forwarder | null): void {
    this.forwarder = fn;
  }

  publishLog(deploymentId: string, frame: LogFrame): void {
    this.emitter.emit(`log:${deploymentId}`, frame);
    this.forwarder?.({ kind: "log", deploymentId, frame });
  }

  publishStatus(deploymentId: string, status: string): void {
    this.emitter.emit(`status:${deploymentId}`, status);
    this.forwarder?.({ kind: "status", deploymentId, status });
  }

  /** Remote frames: local emit only (forwarding again would loop). */
  injectRemote(deploymentId: string, frame: LogFrame): void {
    this.emitter.emit(`log:${deploymentId}`, frame);
  }

  injectRemoteStatus(deploymentId: string, status: string): void {
    this.emitter.emit(`status:${deploymentId}`, status);
  }

  onLog(deploymentId: string, fn: (frame: LogFrame) => void): () => void {
    const ev = `log:${deploymentId}`;
    this.emitter.on(ev, fn);
    return () => this.emitter.off(ev, fn);
  }

  onStatus(deploymentId: string, fn: (status: string) => void): () => void {
    const ev = `status:${deploymentId}`;
    this.emitter.on(ev, fn);
    return () => this.emitter.off(ev, fn);
  }
}

export const logBus = new DeploymentLogBus();
