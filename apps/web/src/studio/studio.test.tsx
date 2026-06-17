// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations, renderComponent } from "../test/component";

import { CommitBar } from "./commit-bar";
import { DataGrid, EditableCell } from "./data-grid";
import { InsertRows } from "./insert-rows";
import { SchemaTree } from "./schema-tree";
import { SqlRunner } from "./sql-runner";
import { Structure } from "./structure";
import { rowKeyOf, type QueryField, type SchemaNode, type TableDetail } from "./types";

// jsdom lacks ResizeObserver, which @tanstack/react-virtual probes; stub it so
// the grid mounts. (Row virtualization needs real layout, so we assert on the
// always-rendered headers/states + interactions, not the windowed row cells.)
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
// CodeMirror probes matchMedia (theming); jsdom lacks it.
if (typeof globalThis.matchMedia === "undefined") {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  })) as unknown as typeof matchMedia;
}

const fields: QueryField[] = [
  { name: "id", dataType: "int4" },
  { name: "email", dataType: "text" },
];
const rows: Record<string, unknown>[] = [
  { id: 1, email: "a@b.com" },
  { id: 2, email: null },
];

describe("DataGrid (component)", () => {
  it("renders sortable column headers and invokes onSort", async () => {
    const onSort = vi.fn();
    const { container } = renderComponent(
      <DataGrid
        fields={fields}
        rows={rows}
        primaryKey={["id"]}
        sort={{ column: "id", dir: "asc" }}
        onSort={onSort}
        loading={false}
      />,
    );
    expect(screen.getByRole("button", { name: /id/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /email/ }));
    expect(onSort).toHaveBeenCalledWith("email");
    await expectNoA11yViolations(container);
  });

  it("shows an empty state when there are no rows", () => {
    renderComponent(
      <DataGrid
        fields={fields}
        rows={[]}
        primaryKey={[]}
        sort={null}
        onSort={() => undefined}
        loading={false}
      />,
    );
    expect(screen.getByText("No rows")).toBeTruthy();
  });
});

describe("SchemaTree (component)", () => {
  const schemas: SchemaNode[] = [
    {
      name: "public",
      tables: [
        { schema: "public", name: "users", kind: "table", estimatedRows: 12 },
        { schema: "public", name: "orders", kind: "table", estimatedRows: null },
      ],
    },
  ];

  it("lists tables under the first (auto-expanded) schema and selects one", async () => {
    const onSelect = vi.fn();
    const { container } = renderComponent(
      <SchemaTree schemas={schemas} selected={null} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /users/ }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: "users", schema: "public" }),
    );
    await expectNoA11yViolations(container);
  });

  it("collapses a schema when its header is toggled", () => {
    renderComponent(<SchemaTree schemas={schemas} selected={null} onSelect={() => undefined} />);
    expect(screen.queryByRole("button", { name: /orders/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /public/ }));
    expect(screen.queryByRole("button", { name: /orders/ })).toBeNull();
  });
});

describe("SqlRunner (component)", () => {
  it("mounts the editor, a Run button, and the empty hint", async () => {
    const { container } = renderComponent(<SqlRunner connId="ext:dbc_x" readOnly />);
    expect(screen.getByRole("button", { name: /run/i })).toBeTruthy();
    expect(screen.getByText("Run a query to see results.")).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it("surfaces recent queries from history storage", () => {
    globalThis.localStorage.setItem(
      "ss.dbstudio.sqlhistory",
      JSON.stringify(["select * from users"]),
    );
    try {
      renderComponent(<SqlRunner connId="ext:dbc_x" readOnly={false} />);
      expect(screen.getByRole("combobox", { name: /query history/i })).toBeTruthy();
      expect(screen.getByRole("option", { name: "select * from users" })).toBeTruthy();
    } finally {
      globalThis.localStorage.removeItem("ss.dbstudio.sqlhistory");
    }
  });
});

describe("EditableCell (component)", () => {
  it("double-click opens an input; Enter commits the new value", () => {
    const onCommit = vi.fn();
    renderComponent(<EditableCell value="old" dirty={false} onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByText("old"));
    const input = screen.getByLabelText("cell value");
    fireEvent.change(input, { target: { value: "new" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("new");
  });

  it("Escape cancels without committing", () => {
    const onCommit = vi.fn();
    renderComponent(<EditableCell value="old" dirty={false} onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByText("old"));
    fireEvent.keyDown(screen.getByLabelText("cell value"), { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("the set-null button commits NULL", () => {
    const onCommit = vi.fn();
    renderComponent(<EditableCell value="old" dirty={false} onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByText("old"));
    fireEvent.mouseDown(screen.getByLabelText("set null"));
    expect(onCommit).toHaveBeenCalledWith(null);
  });
});

describe("CommitBar (component)", () => {
  it("hides at zero, shows the count + actions when pending", async () => {
    const { container, rerender } = renderComponent(
      <CommitBar count={0} busy={false} onDiscard={() => undefined} onCommit={() => undefined} />,
    );
    expect(container.textContent).toBe("");
    rerender(
      <CommitBar count={2} busy={false} onDiscard={() => undefined} onCommit={() => undefined} />,
    );
    expect(screen.getByText(/2 pending changes/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /commit/i })).toBeTruthy();
    await expectNoA11yViolations(container);
  });
});

describe("rowKeyOf", () => {
  it("is stable per primary-key tuple and distinct across rows", () => {
    expect(rowKeyOf(["id"], { id: 7, name: "x" })).toBe(rowKeyOf(["id"], { id: 7, name: "y" }));
    expect(rowKeyOf(["id"], { id: 7 })).not.toBe(rowKeyOf(["id"], { id: 8 }));
  });
});

describe("Structure (component)", () => {
  it("renders columns, the PK marker, and a reconstructed CREATE", async () => {
    const detail: TableDetail = {
      schema: "public",
      name: "users",
      columns: [
        {
          name: "id",
          dataType: "integer",
          uiType: "number",
          nullable: false,
          default: null,
          isPrimaryKey: true,
        },
        {
          name: "email",
          dataType: "text",
          uiType: "string",
          nullable: true,
          default: null,
          isPrimaryKey: false,
        },
      ],
      primaryKey: ["id"],
      indexes: [{ name: "users_email_idx", columns: ["email"], unique: true, primary: false }],
      foreignKeys: [],
    };
    const { container } = renderComponent(<Structure detail={detail} engine="postgres" />);
    expect(screen.getByText("Columns")).toBeTruthy();
    expect(screen.getByText("email")).toBeTruthy();
    expect(screen.getByText("PK")).toBeTruthy();
    expect(screen.getByText("Indexes")).toBeTruthy();
    expect(screen.getByText(/users_email_idx/)).toBeTruthy();
    expect(container.textContent).toContain('CREATE TABLE "public"."users"');
    await expectNoA11yViolations(container);
  });
});

describe("InsertRows (component)", () => {
  it("adds, edits, and removes new rows via callbacks", async () => {
    const onAdd = vi.fn();
    const onChange = vi.fn();
    const onRemove = vi.fn();
    const { container } = renderComponent(
      <InsertRows
        fields={fields}
        rows={[{ id: "new0", values: {} }]}
        onAdd={onAdd}
        onChange={onChange}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add row/i }));
    expect(onAdd).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("new email"), { target: { value: "x@y.com" } });
    expect(onChange).toHaveBeenCalledWith("new0", "email", "x@y.com");
    fireEvent.click(screen.getByRole("button", { name: /discard new row/i }));
    expect(onRemove).toHaveBeenCalledWith("new0");
    await expectNoA11yViolations(container);
  });
});

describe("SqlRunner confirm flow", () => {
  it("offers 'Run anyway' on a destructive 409", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ code: "dbstudio.confirm_required", detail: "destructive" }),
    }) as unknown as typeof fetch;
    try {
      renderComponent(<SqlRunner connId="ext:dbc_x" readOnly={false} />);
      fireEvent.click(screen.getByRole("button", { name: /^run$/i }));
      expect(await screen.findByRole("button", { name: /run anyway/i })).toBeTruthy();
    } finally {
      globalThis.fetch = orig;
    }
  });
});
