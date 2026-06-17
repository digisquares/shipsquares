// Minimal SSE frame parser for streamed chat turns (22): frames are
// `event: name\ndata: <json>\n\n`. push() takes raw chunk text (frames may
// split anywhere) and returns the completed events; malformed data is
// dropped rather than poisoning the stream.

export interface SseEvent {
  event: string;
  data: unknown;
}

export function createSseParser() {
  let buffer = "";
  return {
    push(chunk: string): SseEvent[] {
      buffer += chunk;
      const events: SseEvent[] = [];
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let event = "message";
        let data = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7).trim();
          else if (line.startsWith("data: ")) data = line.slice(6);
        }
        if (!data) continue;
        try {
          events.push({ event, data: JSON.parse(data) });
        } catch {
          // malformed frame — skip it
        }
      }
      return events;
    },
  };
}
