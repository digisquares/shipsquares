import type { QueryField } from "./types";

// Result-set export (database-studio/05, R(db).3). toCsv/toJson are pure +
// unit-tested; download wraps the DOM Blob/anchor dance. Exports the rows the
// grid currently holds (the active page) — no server round-trip.

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(fields: QueryField[], rows: Record<string, unknown>[]): string {
  const header = fields.map((f) => csvCell(f.name)).join(",");
  const body = rows.map((r) => fields.map((f) => csvCell(r[f.name])).join(",")).join("\n");
  return body ? `${header}\n${body}` : header;
}

export function toJson(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2);
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
