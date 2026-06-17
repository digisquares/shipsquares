// Sparkline geometry (25-design-system.md: "tiny inline metrics in tables").
// Pure + unit-tested; the SVG component is components/sparkline.tsx.

export interface SparklineGeom {
  /** points for <polyline> ("x,y x,y …") */
  line: string;
  /** closed path for the filled area under the line */
  area: string;
  /** last data point (for the leading-edge dot), or null if too few points */
  last: { x: number; y: number } | null;
}

export interface SparklineOptions {
  width?: number;
  height?: number;
  min?: number;
  max?: number;
}

const round = (n: number): number => Math.round(n * 100) / 100;

export function sparklinePoints(data: number[], opts: SparklineOptions = {}): SparklineGeom {
  const width = opts.width ?? 140;
  const height = opts.height ?? 30;
  if (data.length < 2) return { line: "", area: "", last: null };

  const min = opts.min ?? 0;
  const max = opts.max ?? 100;
  const span = max - min || 1;

  const pts = data.map((v, i) => {
    const x = round((i / (data.length - 1)) * width);
    const clamped = Math.min(Math.max(v, min), max);
    const y = round(height - ((clamped - min) / span) * height);
    return { x, y };
  });

  const line = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const first = pts[0]!;
  const lastPt = pts[pts.length - 1]!;
  const area =
    `M ${first.x},${first.y} ` +
    pts
      .slice(1)
      .map((p) => `L ${p.x},${p.y}`)
      .join(" ") +
    ` L ${lastPt.x},${height} L ${first.x},${height} Z`;

  return { line, area, last: { x: lastPt.x, y: lastPt.y } };
}
