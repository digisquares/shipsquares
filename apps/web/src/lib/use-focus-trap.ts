import { useEffect, useRef } from "react";

// Trap keyboard focus within an overlay while it is mounted (docs/platform-review
// 03-ui-ux.md §2, defect #2). Tab / Shift+Tab cycle among the container's
// focusable descendants instead of escaping to the page behind, and focus
// returns to whatever had it when the overlay opened. The overlay component still
// owns initial focus (e.g. Cancel on a destructive confirm) and Escape-to-close;
// this only closes the "Tab leaks out / focus is lost on close" gap.
//
// Attach the returned ref to the dialog container. Assumes the container mounts
// when the overlay opens and unmounts when it closes (the pattern every overlay
// here uses), so the trap is scoped to that lifetime.

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useFocusTrap<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || activeEl === container)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      // Return focus to the trigger, if it's still in the document.
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);
  return ref;
}
