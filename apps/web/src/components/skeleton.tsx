// Content-shaped loading skeletons (25-design-system.md, principle 6: skeletons,
// not spinners). Shimmer is gated on prefers-reduced-motion in CSS.

type Size = number | string;

export function Skeleton({
  width,
  height = 14,
  radius,
}: {
  width?: Size;
  height?: Size;
  radius?: Size;
}) {
  return <span className="skeleton" style={{ width, height, borderRadius: radius }} aria-hidden />;
}

// A few list-row skeletons (status dot + name + meta), matching the app list.
export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="skeleton-rows" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-row">
          <Skeleton width={8} height={8} radius={999} />
          <Skeleton width="36%" />
          <Skeleton width="20%" />
        </div>
      ))}
    </div>
  );
}
