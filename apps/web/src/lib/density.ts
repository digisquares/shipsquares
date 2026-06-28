import { useEffect, useState } from "react";

// Density switch (docs/web-ui/01, §8): "comfortable" (default) vs "compact" for
// data-dense screens. Mirrors lib/theme — the choice rides <html data-density>,
// is persisted, and a `ss:density` event keeps every reader (the menu toggle) in
// sync. Compact only tightens row/table spacing; everything else is unchanged.
export type Density = "comfortable" | "compact";

const KEY = "ss-density";
const EVENT = "ss:density";

function read(): Density {
  return typeof document !== "undefined" && document.documentElement.dataset.density === "compact"
    ? "compact"
    : "comfortable";
}

export function setDensity(density: Density): void {
  if (density === "compact") document.documentElement.dataset.density = "compact";
  else delete document.documentElement.dataset.density;
  try {
    localStorage.setItem(KEY, density);
  } catch {
    /* storage unavailable — keep the in-memory choice */
  }
  window.dispatchEvent(new CustomEvent<Density>(EVENT, { detail: density }));
}

export function useDensity(): { density: Density; toggle: () => void } {
  const [density, setState] = useState<Density>(read);
  useEffect(() => {
    const onChange = (e: Event) => setState((e as CustomEvent<Density>).detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return { density, toggle: () => setDensity(density === "compact" ? "comfortable" : "compact") };
}
