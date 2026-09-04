import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { linter, lintGutter } from '@codemirror/lint';
import { oneDark } from '@codemirror/theme-one-dark';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { parseSpec } from './parse.js';

const langConf = new Compartment();
const themeConf = new Compartment();

// 디자인 팔레트에 맞춘 라이트 구문 강조 (key/str/num/com/punct)
const lightHighlight = HighlightStyle.define([
  { tag: [t.definition(t.propertyName), t.propertyName, t.keyword, t.atom], color: '#1f6f8b' },
  { tag: [t.string, t.special(t.string), t.attributeValue], color: '#a4620b' },
  { tag: [t.number, t.bool, t.null, t.literal], color: '#7c3aed' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#a8a29e', fontStyle: 'italic' },
  { tag: [t.punctuation, t.separator, t.meta, t.operator], color: '#78716c' },
  { tag: [t.invalid], color: '#d63b3b' },
]);

// 라이트 모드: 기본 텍스트 색상·거터를 디자인에 맞춤 + 구문 강조
const lightTheme = [
  EditorView.theme({
    '&': { color: '#1c1917' },
    '.cm-gutters': { background: '#faf9f8', color: '#c4bdb3', border: 'none', borderRight: '1px solid #e5e2de' },
    '.cm-activeLineGutter': { background: 'transparent' },
    '.cm-activeLine': { background: 'rgba(53,87,214,.04)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { background: '#dbe6ff' },
  }),
  syntaxHighlighting(lightHighlight),
];

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

export function createEditor(host, { ext = 'yaml', doc = '', dark = false, onChange, onCursor } = {}) {
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
        themeConf.of(dark ? oneDark : lightTheme),
        lintGutter(),
        makeLinter(getExt),
        updateListener,
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { fontFamily: 'var(--mono)', fontSize: '12.5px' },
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
    setTheme(isDark) {
      view.dispatch({ effects: themeConf.reconfigure(isDark ? oneDark : lightTheme) });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
