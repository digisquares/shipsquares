// Downsample a metric series into fixed time buckets (32-monitoring-metrics.md).
// Pure equivalent of Postgres date_bin aggregation, used to serve chart series
// without shipping every raw sample. Buckets are returned oldest-first.

export interface Sample {
  ts: number; // epoch ms
  value: number;
}

export interface Bucket {
  ts: number; // bucket start (epoch ms)
  avg: number;
  min: number;
  max: number;
  count: number;
}

export function bucketSamples(samples: Sample[], stepMs: number): Bucket[] {
  if (stepMs <= 0) throw new Error("stepMs must be > 0");
  const groups = new Map<number, number[]>();
  for (const s of samples) {
    const start = Math.floor(s.ts / stepMs) * stepMs;
    const arr = groups.get(start);
    if (arr) arr.push(s.value);
    else groups.set(start, [s.value]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, values]) => ({
      ts,
      avg: values.reduce((sum, v) => sum + v, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length,
    }));
}
