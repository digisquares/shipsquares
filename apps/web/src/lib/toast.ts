// Non-blocking toast notifications (25-design-system.md: "Toasts (Sonner):
// non-blocking, with undo where possible"). A tiny framework-agnostic store —
// the pure reducers are unit-tested; <Toaster> subscribes via
// useSyncExternalStore. Auto-id counter (no Date.now/random).

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Optional one-shot action (e.g. Undo). */
  action?: { label: string; run: () => void };
}

export const MAX_TOASTS = 4;

// Keep at most `max` toasts, dropping the oldest (pure).
export function addToast(list: Toast[], t: Toast, max = MAX_TOASTS): Toast[] {
  const next = [...list, t];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function dismissToast(list: Toast[], id: number): Toast[] {
  return list.filter((t) => t.id !== id);
}

let nextId = 1;
let current: Toast[] = [];
const listeners = new Set<() => void>();

function set(list: Toast[]): void {
  current = list;
  for (const l of listeners) l();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getToasts(): Toast[] {
  return current;
}

export function dismiss(id: number): void {
  set(dismissToast(current, id));
}

function show(
  kind: ToastKind,
  message: string,
  opts?: { ttl?: number; action?: Toast["action"] },
): number {
  const id = nextId;
  nextId += 1;
  set(addToast(current, { id, kind, message, action: opts?.action }));
  const ttl = opts?.ttl ?? (kind === "error" ? 6000 : 4000);
  if (ttl > 0 && typeof setTimeout !== "undefined") {
    setTimeout(() => dismiss(id), ttl);
  }
  return id;
}

export const toast = {
  info: (message: string, opts?: { ttl?: number; action?: Toast["action"] }) =>
    show("info", message, opts),
  success: (message: string, opts?: { ttl?: number; action?: Toast["action"] }) =>
    show("success", message, opts),
  error: (message: string, opts?: { ttl?: number; action?: Toast["action"] }) =>
    show("error", message, opts),
};
