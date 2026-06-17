// Pure SVG geometry for the metric history charts (ROADMAP R1.4): the avg
// line, the min–max envelope band, and time-axis ticks. Hand-rolled SVG —
// no chart dependency — matching the hand-rolled design system.

export interface SeriesPoint {
  ts: number;
  avg: number;
  min: number;
  max: number;
  count: number;
}

function scales(points: SeriesPoint[], w: number, h: number, yMax: number) {
  const t0 = points[0]!.ts;
  const t1 = points[points.length - 1]!.ts;
  const span = Math.max(1, t1 - t0);
  const x = (ts: number): number => ((ts - t0) / span) * w;
  const y = (v: number): number => h - (Math.min(yMax, Math.max(0, v)) / yMax) * h;
  return { x, y };
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

export function linePath(points: SeriesPoint[], w: number, h: number, yMax: number): string {
  if (points.length < 2) return "";
  const { x, y } = scales(points, w, h, yMax);
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${fmt(x(p.ts))},${fmt(y(p.avg))}`).join(" ");
}

/** min–max envelope: max edge forward, min edge backward, closed. */
export function bandPath(points: SeriesPoint[], w: number, h: number, yMax: number): string {
  if (points.length < 2) return "";
  const { x, y } = scales(points, w, h, yMax);
  const top = points.map((p, i) => `${i === 0 ? "M" : "L"}${fmt(x(p.ts))},${fmt(y(p.max))}`);
  const bottom = [...points].reverse().map((p) => `L${fmt(x(p.ts))},${fmt(y(p.min))}`);
  return `${top.join(" ")} ${bottom.join(" ")} Z`;
}

export interface TimeTick {
  x: number;
  label: string;
}

export function timeTicks(points: SeriesPoint[], w: number, count: number): TimeTick[] {
  if (points.length < 2 || count < 2) return [];
  const t0 = points[0]!.ts;
  const t1 = points[points.length - 1]!.ts;
  const ticks: TimeTick[] = [];
  for (let i = 0; i < count; i += 1) {
    const frac = i / (count - 1);
    const ts = t0 + (t1 - t0) * frac;
    const d = new Date(ts);
    ticks.push({
      x: Math.round(frac * w * 100) / 100,
      label: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    });
  }
  return ticks;
}
