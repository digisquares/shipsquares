// In-process monotonic per-deployment seq (28-deployment-logs.md). Avoids a
// count(*) per line; released when a deployment finishes.
export class SeqCounter {
  private readonly counters = new Map<string, number>();

  next(deploymentId: string): number {
    const value = (this.counters.get(deploymentId) ?? 0) + 1;
    this.counters.set(deploymentId, value);
    return value;
  }

  current(deploymentId: string): number {
    return this.counters.get(deploymentId) ?? 0;
  }

  release(deploymentId: string): void {
    this.counters.delete(deploymentId);
  }
}
