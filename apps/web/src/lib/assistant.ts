// Pure helpers for the assistant panel (22): a one-line, ordered summary of
// what the turn actually did — tool names deduped with counts, failures
// flagged — rendered under the assistant's answer.

export interface AssistantToolEvent {
  tool: string;
  input?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}

export function toolSummary(events: AssistantToolEvent[]): string | null {
  if (events.length === 0) return null;
  const order: string[] = [];
  const counts = new Map<string, { n: number; failed: boolean }>();
  for (const e of events) {
    const entry = counts.get(e.tool);
    if (entry) {
      entry.n += 1;
      entry.failed = entry.failed || e.isError === true;
    } else {
      order.push(e.tool);
      counts.set(e.tool, { n: 1, failed: e.isError === true });
    }
  }
  const parts = order.map((tool) => {
    const { n, failed } = counts.get(tool)!;
    return `${tool}${n > 1 ? ` ×${n}` : ""}${failed ? " ⚠" : ""}`;
  });
  return `ran ${parts.join(" · ")}`;
}
