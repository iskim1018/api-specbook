import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { linter, lintGutter } from '@codemirror/lint';
import { parseSpec } from './parse.js';

const langConf = new Compartment();

function langFor(ext) {
  return ext === 'json' ? json() : yaml();
}

// 구문 검사: parseSpec 결과를 CodeMirror diagnostic 으로 변환
function makeLinter(getExt) {
  return linter((view) => {
    const text = view.state.doc.toString();
    if (!text.trim()) return [];
    const { error } = parseSpec(text, getExt());
    if (!error) return [];
    const line = Math.min(Math.max(error.line, 1), view.state.doc.lines);
    const lineObj = view.state.doc.line(line);
    const from = Math.min(lineObj.from + Math.max(error.col - 1, 0), lineObj.to);
    return [{
      from,
      to: lineObj.to,
      severity: 'error',
      message: error.message,
    }];
  }, { delay: 350 });
}

export function createEditor(host, { ext = 'yaml', doc = '', onChange, onCursor } = {}) {
  let currentExt = ext;
  const getExt = () => currentExt;

  const updateListener = EditorView.updateListener.of((u) => {
    if (u.docChanged && onChange) onChange(u.state.doc.toString());
    if (onCursor && (u.selectionSet || u.docChanged)) {
      const pos = u.state.selection.main.head;
      const line = u.state.doc.lineAt(pos);
      onCursor({ line: line.number, col: pos - line.from + 1 });
    }
  });

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        langConf.of(langFor(ext)),
        lintGutter(),
        makeLinter(getExt),
        updateListener,
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { fontFamily: 'var(--mono)', fontSize: '12.5px' },
          '.cm-gutters': { background: 'var(--panel-2)', border: 'none', borderRight: '1px solid var(--border)' },
        }),
      ],
    }),
  });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setDoc(text, newExt) {
      currentExt = newExt || currentExt;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        effects: langConf.reconfigure(langFor(currentExt)),
      });
    },
    setExt(newExt) {
      currentExt = newExt;
      view.dispatch({ effects: langConf.reconfigure(langFor(newExt)) });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
