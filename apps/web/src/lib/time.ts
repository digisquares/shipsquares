// Compact relative timestamps ("2 min ago", "3h ago") for scannable density
// (25-design-system.md). Pure + unit-tested; `now` is injectable for tests.
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const deltaSec = Math.round((now - then) / 1000); // > 0 = in the past
  const a = Math.abs(deltaSec);
  const phrase =
    a < 45
      ? "just now"
      : a < 90
        ? "1 min"
        : a < 3600
          ? `${Math.round(a / 60)} min`
          : a < 86400
            ? `${Math.round(a / 3600)}h`
            : a < 2592000
              ? `${Math.round(a / 86400)}d`
              : a < 31536000
                ? `${Math.round(a / 2592000)}mo`
                : `${Math.round(a / 31536000)}y`;
  if (phrase === "just now") return phrase;
  return deltaSec >= 0 ? `${phrase} ago` : `in ${phrase}`;
}
