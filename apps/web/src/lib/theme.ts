import { useEffect, useState } from "react";

import { type Theme } from "./colors";

// Theme switch (25-design-system.md): dark default, system-aware, persisted.
// The actual <html data-theme> is set pre-paint by an inline script in
// index.html (no flash); this module reads/flips it and keeps React in sync via
// a `ss:theme` event so the toggle button and the ⌘K command stay consistent.
const KEY = "ss-theme";
const EVENT = "ss:theme";

function read(): Theme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light"
    ? "light"
    : "dark";
}

// NOTE: stored-theme + system-preference resolution lives ONLY in the inline
// pre-paint script in index.html (the no-flash requirement); this module reads
// the resolved <html data-theme> via read(). Dead duplicates of that logic
// were removed — keep it single-source.

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable — keep the in-memory choice */
  }
  window.dispatchEvent(new CustomEvent<Theme>(EVENT, { detail: theme }));
}

export function toggleTheme(): Theme {
  const next: Theme = read() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setThemeState] = useState<Theme>(read);
  useEffect(() => {
    const onChange = (e: Event) => setThemeState((e as CustomEvent<Theme>).detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return { theme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}
