import { describe, expect, it } from "vitest";

import { toCsv, toJson } from "./export";
import type { QueryField } from "./types";

const fields: QueryField[] = [
  { name: "id", dataType: "int4" },
  { name: "note", dataType: "text" },
];

describe("toCsv", () => {
  it("emits a header + rows, quoting commas/quotes/newlines and blanking null", () => {
    const csv = toCsv(fields, [
      { id: 1, note: "a,b" },
      { id: 2, note: null },
      { id: 3, note: 'he said "hi"' },
    ]);
    expect(csv).toBe('id,note\n1,"a,b"\n2,\n3,"he said ""hi"""');
  });

  it("is header-only when there are no rows", () => {
    expect(toCsv(fields, [])).toBe("id,note");
  });

  it("serializes object cells as JSON", () => {
    expect(toCsv([{ name: "j", dataType: "jsonb" }], [{ j: { a: 1 } }])).toBe('j\n"{""a"":1}"');
  });
});

describe("toJson", () => {
  it("pretty-prints rows", () => {
    expect(toJson([{ id: 1 }])).toBe('[\n  {\n    "id": 1\n  }\n]');
  });
});
