import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

// Shared form primitives (docs/platform-review 03-ui-ux.md §4, defect #6). Thin
// wrappers over the existing token classes (`.field`, `.field-label`,
// `.chat-input`) so adoption is a pure consolidation — identical rendered
// markup, no visual change — while new forms reach for one obvious component
// instead of copying whichever bespoke input class set is nearest. Extra
// `className` (e.g. "mono") is appended, not replaced.

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={className ? `chat-input ${className}` : "chat-input"} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={className ? `role-select ${className}` : "role-select"} {...props}>
      {children}
    </select>
  );
}
