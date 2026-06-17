// Imperative confirm dialog (25-design-system.md: "confirm on destructive").
// `await confirm({...})` resolves true/false. A tiny store drives the single
// <ConfirmDialog> host; normalizeConfirm (defaults) is pure + unit-tested.

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface ConfirmRequest {
  id: number;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
}

export function normalizeConfirm(id: number, o: ConfirmOptions): ConfirmRequest {
  const danger = o.danger ?? false;
  return {
    id,
    title: o.title,
    message: o.message,
    confirmLabel: o.confirmLabel ?? (danger ? "Delete" : "Confirm"),
    cancelLabel: o.cancelLabel ?? "Cancel",
    danger,
  };
}

let nextId = 1;
let current: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getRequest(): ConfirmRequest | null {
  return current;
}

export function confirm(o: ConfirmOptions): Promise<boolean> {
  // Superseding an open dialog cancels the prior one.
  if (current) {
    const prev = current;
    current = null;
    prev.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    const id = nextId;
    nextId += 1;
    current = { ...normalizeConfirm(id, o), resolve };
    emit();
  });
}

export function resolveConfirm(ok: boolean): void {
  if (!current) return;
  const c = current;
  current = null;
  c.resolve(ok);
  emit();
}
