import { sql } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

// CodeMirror 6 SQL editor, themed to the design tokens (database-studio/05).
// Mount-once (like the xterm console): the editor owns its document; onChange
// streams edits out, ⌘/Ctrl+↵ runs. Lean modules (no Monaco) — bundled into the
// code-split studio chunk.
export function SqlEditor({
  value,
  onChange,
  onRun,
  schema,
}: {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  /** table -> columns map for autocomplete (columns may be empty for table-only). */
  schema?: Record<string, string[]>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const theme = EditorView.theme(
      {
        "&": {
          backgroundColor: "transparent",
          color: "var(--text)",
          height: "100%",
          fontSize: "13px",
        },
        ".cm-content": { fontFamily: "var(--font-mono)", caretColor: "var(--accent)" },
        ".cm-gutters": {
          backgroundColor: "var(--surface-1)",
          color: "var(--text-muted)",
          border: "none",
        },
        ".cm-activeLine": { backgroundColor: "var(--accent-soft)" },
        ".cm-activeLineGutter": { backgroundColor: "var(--accent-soft)" },
        "&.cm-focused": { outline: "none" },
        ".cm-selectionBackground, ::selection": { backgroundColor: "var(--accent-soft)" },
      },
      { dark: true },
    );
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          sql(schema ? { schema } : {}),
          theme,
          EditorView.contentAttributes.of({ "aria-label": "SQL editor" }),
          keymap.of([
            {
              key: "Mod-Enter",
              preventDefault: true,
              run: () => {
                onRunRef.current();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view.destroy();
  }, []);

  return <div className="sql-editor" ref={hostRef} />;
}
