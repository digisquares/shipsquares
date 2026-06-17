import { useId } from "react";

import { sparklinePoints } from "../lib/sparkline";

// Tiny inline metric chart (25-design-system.md). Gradient area fill under the
// line + a leading-edge dot. Decorative (the numeric value is shown alongside),
// so aria-hidden. Scales to its container via viewBox.
export function Sparkline({
  data,
  color,
  width = 140,
  height = 30,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  const gradId = `spark-${useId().replace(/:/g, "")}`;
  const geom = sparklinePoints(data, { width, height });
  if (!geom.line || !geom.last) {
    return <svg viewBox={`0 0 ${width} ${height}`} className="spark" aria-hidden />;
  }
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="spark"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={geom.area} fill={`url(#${gradId})`} stroke="none" />
      <polyline
        points={geom.line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={geom.last.x}
        cy={geom.last.y}
        r="2"
        fill={color}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
