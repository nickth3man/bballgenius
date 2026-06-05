import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { useEffect, useRef } from 'react';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  completer?: (
    context: CompletionContext,
  ) => { from: number; options: { label: string; type: string }[] } | null;
}

export function CodeEditor({ value, onChange, onRun, completer }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onRunRef = useRef(onRun);

  onRunRef.current = onRun;

  useEffect(() => {
    if (!containerRef.current) return;

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      keymap.of([...defaultKeymap, indentWithTab]),
      sql({ dialect: PostgreSQL }),
      oneDark,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString());
        }
      }),
    ];

    if (completer) {
      extensions.push(autocompletion({ override: [completer] }));
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        onRunRef.current();
      }
    };
    view.dom.addEventListener('keydown', handleKey);

    return () => {
      view.dom.removeEventListener('keydown', handleKey);
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completer, onChange, value]);

  return <div ref={containerRef} className="h-full overflow-auto border border-border" />;
}
