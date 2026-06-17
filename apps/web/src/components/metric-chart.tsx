import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { type SeriesPoint, bandPath, linePath, timeTicks } from "../lib/chart";

// Metric history chart (ROADMAP R1.4): bucketed series from
// /apps/:id/metrics/series rendered as an avg line over a min–max envelope.
// CPU and memory are both percentages, so one 0–100 axis serves both.

interface Series {
  metric: string;
  range: string;
  stepMs: number;
  memLimitBytes: number | null;
  points: SeriesPoint[];
}

const RANGES = ["1h", "24h", "7d"] as const;
const W = 560;
const H = 120;

export function MetricChart({ appId }: { appId: string }) {
  const [metric, setMetric] = useState<"cpu" | "mem">("cpu");
  const [range, setRange] = useState<(typeof RANGES)[number]>("1h");
  const [series, setSeries] = useState<Series | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await api.get<Series>(
        `/api/v1/apps/${appId}/metrics/series?metric=${metric}&range=${range}`,
      );
      if (!alive) return;
      setFailed(!r.ok);
      setSeries(r.ok ? r.data : null);
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [appId, metric, range]);

  const points = series?.points ?? [];
  const last = points.at(-1);
  const ticks = timeTicks(points, W, 4);

  return (
    <div className="mchart">
      <div className="mchart-head">
        <div className="mchart-toggles" role="tablist" aria-label="Metric">
          {(["cpu", "mem"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={metric === m}
              className={`mchart-toggle${metric === m ? " on" : ""}`}
              onClick={() => setMetric(m)}
            >
              {m === "cpu" ? "CPU" : "Memory"}
            </button>
          ))}
        </div>
        <div className="mchart-toggles" role="tablist" aria-label="Range">
          {RANGES.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={range === r}
              className={`mchart-toggle${range === r ? " on" : ""}`}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
        {last && (
          <span className="mchart-last mono">
            {Math.round(last.avg * 10) / 10}% {metric === "cpu" ? "cpu" : "of limit"}
          </span>
        )}
      </div>

      {points.length < 2 ? (
        <p className="muted mchart-empty">
          {failed
            ? "Couldn't load the series — check the server."
            : "Not enough samples yet — the collector records one per minute."}
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="mchart-svg"
          role="img"
          aria-label={`${metric} over the last ${range}`}
          preserveAspectRatio="none"
        >
          {[25, 50, 75].map((p) => (
            <line
              key={p}
              x1="0"
              x2={W}
              y1={H - (p / 100) * H}
              y2={H - (p / 100) * H}
              className="mchart-grid"
            />
          ))}
          <path d={bandPath(points, W, H, 100)} className="mchart-band" />
          <path d={linePath(points, W, H, 100)} className="mchart-line" />
        </svg>
      )}
      {ticks.length > 0 && (
        <div className="mchart-ticks mono" aria-hidden>
          {ticks.map((t) => (
            <span key={t.x} style={{ left: `${(t.x / W) * 100}%` }}>
              {t.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
