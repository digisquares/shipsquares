import { toast } from "../lib/toast";

// Small copy-to-clipboard button with toast feedback (used for webhook URL/
// secret, etc.). Falls back to an error toast where the clipboard API is
// unavailable (e.g. insecure context).
export function CopyButton({
  text,
  what = "value",
  label = "Copy",
}: {
  text: string;
  what?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      aria-label={`Copy ${what}`}
      onClick={async () => {
        try {
          if (!navigator.clipboard) throw new Error("clipboard unavailable");
          await navigator.clipboard.writeText(text);
          toast.success(`Copied ${what}`);
        } catch {
          toast.error("Couldn't copy — copy it manually");
        }
      }}
    >
      {label}
    </button>
  );
}
