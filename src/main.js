import './style.css';
import { buildModel } from '../core/model.mjs';
import { renderHtml } from '../core/render.mjs';
import { parseSpec } from './parse.js';
import { createEditor } from './editor.js';
import { createViewer } from './viewer.js';
import { renderTree } from './tree.js';
import {
  isTauri, extOf, baseName, isSpecFile,
  openFileDialog, openFolderDialog, readFile, saveFile, saveAsDialog, exportHtml,
} from './fileio.js';
import { SAMPLE_NAME, SAMPLE_YAML } from './sample.js';

// ---------- 앱 셸 ----------
const app = document.getElementById('app');
app.innerHTML = `
<div class="app-shell">
  <div class="toolbar">
    <div class="tb-group">
      <button class="btn ghost-strong" id="btn-open">${ic('file')}파일 열기</button>
      <button class="btn" id="btn-folder">${ic('folder')}폴더 열기</button>
      <button class="btn" id="btn-save">${ic('save')}저장</button>
    </div>
    <div class="tb-sep"></div>
    <button class="btn primary" id="btn-convert">${ic('refresh')}변환</button>
    <div class="tb-sep"></div>
    <button class="btn" id="btn-export">${ic('export')}내보내기</button>
    <div class="tb-spacer"></div>
    <div class="status-pill ok" id="doc-status"><span class="dot"></span>유효한 문서</div>
  </div>

  <div class="body">
    <!-- 탐색기 -->
    <div class="panel explorer">
      <div class="panel-head"><span class="panel-title">탐색기</span></div>
      <div class="tree" id="tree"></div>
      <div class="dropzone">${ic('upload', 22)}<span>YAML · JSON 파일을<br>여기로 끌어다 놓으세요</span></div>
    </div>
    <div class="gutter" data-gutter="tree"></div>

    <!-- 에디터 -->
    <div class="panel editor-panel">
      <div class="tabbar" id="tabbar"></div>
      <div class="cm-host" id="cm-host"></div>
      <div class="err-chip hidden" id="err-chip"></div>
      <div class="statusbar">
        <span id="sb-pos">줄 1, 칸 1</span>
        <span id="sb-lang">YAML</span>
        <span>UTF-8</span>
        <span class="sb-spacer"></span>
        <span class="valid ok" id="sb-valid"><span class="dot"></span>정상</span>
      </div>
    </div>
    <div class="gutter" data-gutter="editor"></div>

    <!-- 뷰어 -->
    <div class="panel viewer-panel">
      <div class="panel-head" style="padding:0;">
        <div class="viewer-tabs">
          <div class="vtab" data-vtab="swagger">${ic('layers')}Swagger UI</div>
          <div class="vtab active" data-vtab="doc">${ic('doc')}문서 (HTML)</div>
        </div>
      </div>
      <div class="viewer-body" id="viewer-body"></div>
    </div>
  </div>
</div>
<div class="drop-overlay" id="drop-overlay">
  <div class="drop-card">${ic('upload', 40)}<div class="big">여기에 놓으세요</div><div class="sub">OpenAPI YAML / JSON 파일</div></div>
</div>
`;

// ---------- 상태 ----------
const openFiles = new Map(); // path -> { path, name, ext, content, dirty }
let treeFiles = [];          // [{ path, name, dir, content? }]
let folderName = null;
let activePath = null;
let lastValidStatus = { ok: true, count: 0 };

// ---------- 인스턴스 ----------
const viewer = createViewer(document.getElementById('viewer-body'));
const editor = createEditor(document.getElementById('cm-host'), {
  ext: 'yaml',
  doc: '',
  onChange: onEditorChange,
  onCursor: ({ line, col }) => { document.getElementById('sb-pos').textContent = `줄 ${line}, 칸 ${col}`; },
});

// ---------- 미리보기 갱신 ----------
let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 300);
}

function updatePreview() {
  const f = activePath ? openFiles.get(activePath) : null;
  if (!f) return;
  const { doc, error } = parseSpec(f.content, f.ext);
  const errChip = document.getElementById('err-chip');
  const sbValid = document.getElementById('sb-valid');
  const docStatus = document.getElementById('doc-status');

  if (error) {
    errChip.className = 'err-chip';
    errChip.innerHTML = `${ic('alert', 15)}<span><b>줄 ${error.line}</b> · ${escapeHtml(error.message)}</span>`;
    sbValid.className = 'valid err';
    sbValid.innerHTML = '<span class="dot"></span>구문 오류';
    docStatus.className = 'status-pill err';
    docStatus.innerHTML = `<span class="dot"></span>오류 1개`;
    return;
  }

  errChip.className = 'err-chip hidden';
  sbValid.className = 'valid ok';
  sbValid.innerHTML = '<span class="dot"></span>정상';
  docStatus.className = 'status-pill ok';
  docStatus.innerHTML = `<span class="dot"></span>유효한 문서`;

  try {
    const model = buildModel(doc);
    const html = renderHtml(model);
    viewer.setContent({ html, spec: doc });
  } catch (e) {
    errChip.className = 'err-chip';
    errChip.innerHTML = `${ic('alert', 15)}<span>렌더링 오류: ${escapeHtml(e.message || String(e))}</span>`;
  }
}

function onEditorChange(text) {
  if (!activePath) return;
  const f = openFiles.get(activePath);
  if (!f) return;
  if (f.content !== text) {
    f.content = text;
    if (!f.dirty) { f.dirty = true; renderTabs(); refreshTree(); }
  }
  schedulePreview();
}

// ---------- 파일/탭 관리 ----------
function openContent({ path, name, content }) {
  const ext = extOf(name) || 'yaml';
  const existing = openFiles.get(path);
  if (existing) { activate(path); return; }
  openFiles.set(path, { path, name, ext, content, dirty: false });
  activate(path);
}

function activate(path) {
  activePath = path;
  const f = openFiles.get(path);
  editor.setDoc(f.content, f.ext);
  document.getElementById('sb-lang').textContent = f.ext.toUpperCase();
  renderTabs();
  refreshTree();
  updatePreview();
  editor.focus();
}

async function selectTreeFile(file) {
  if (openFiles.has(file.path)) { activate(file.path); return; }
  let content = file.content;
  if (content == null) {
    try { content = await readFile(file.path); }
    catch (e) { alert('파일을 읽을 수 없습니다: ' + (e.message || e)); return; }
  }
  openContent({ path: file.path, name: file.name, content });
}

function closeFile(path) {
  const f = openFiles.get(path);
  if (f?.dirty && !confirm(`${f.name} 의 변경사항이 저장되지 않았습니다. 닫을까요?`)) return;
  openFiles.delete(path);
  if (activePath === path) {
    const next = [...openFiles.keys()].pop() || null;
    if (next) activate(next);
    else { activePath = null; editor.setDoc('', 'yaml'); viewer.clear(); renderTabs(); }
  } else {
    renderTabs();
  }
  refreshTree();
}

// ---------- 렌더: 탭바 ----------
function renderTabs() {
  const bar = document.getElementById('tabbar');
  bar.innerHTML = '';
  for (const f of openFiles.values()) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (f.path === activePath ? ' active' : '');
    tab.innerHTML =
      (f.dirty ? '<span class="dirty-dot"></span>' : '') +
      `<span>${escapeHtml(f.name)}</span>` +
      `<span class="close">${ic('x', 13)}</span>`;
    tab.addEventListener('click', (e) => {
      if (e.target.closest('.close')) { closeFile(f.path); return; }
      activate(f.path);
    });
    bar.appendChild(tab);
  }
}

// ---------- 렌더: 트리 ----------
function refreshTree() {
  const el = document.getElementById('tree');
  // 폴더를 안 열었으면, 열린 파일들을 트리로 보여준다.
  const files = treeFiles.length ? treeFiles : [...openFiles.values()].map((f) => ({ path: f.path, name: f.name, dir: null }));
  if (!files.length) {
    el.innerHTML = `<div class="tree-empty">${ic('folder', 34)}<span>아직 열린 파일이 없습니다.<br>파일 또는 폴더를 여세요.</span></div>`;
    return;
  }
  const dirtyPaths = new Set([...openFiles.values()].filter((f) => f.dirty).map((f) => f.path));
  renderTree(el, { files, activePath, dirtyPaths, folderName }, { onSelect: selectTreeFile });
}

// ---------- 툴바 동작 ----------
document.getElementById('btn-open').addEventListener('click', async () => {
  const r = await openFileDialog();
  if (r) openContent(r);
});

document.getElementById('btn-folder').addEventListener('click', async () => {
  const r = await openFolderDialog();
  if (!r) return;
  treeFiles = r.entries.map((e) => ({ path: e.path, name: e.name, dir: e.dir ?? r.dir, content: e.content }));
  folderName = r.dir;
  refreshTree();
  if (treeFiles[0]) selectTreeFile(treeFiles[0]);
});

document.getElementById('btn-save').addEventListener('click', doSave);
async function doSave() {
  const f = activePath ? openFiles.get(activePath) : null;
  if (!f) return;
  try {
    if (isTauri && f.path && !f.path.startsWith('(')) await saveFile(f.path, f.content);
    else await saveAsDialog(f.name, f.content);
    f.dirty = false; renderTabs(); refreshTree();
  } catch (e) { alert('저장 실패: ' + (e.message || e)); }
}

document.getElementById('btn-convert').addEventListener('click', () => {
  setViewerTab('doc');
  updatePreview();
});

document.getElementById('btn-export').addEventListener('click', async () => {
  const f = activePath ? openFiles.get(activePath) : null;
  if (!f) return;
  const { doc, error } = parseSpec(f.content, f.ext);
  if (error) { alert('문서에 오류가 있어 내보낼 수 없습니다: ' + error.message); return; }
  const html = renderHtml(buildModel(doc));
  const outName = f.name.replace(/\.(ya?ml|json)$/i, '') + '.html';
  try { await exportHtml(outName, html); }
  catch (e) { alert('내보내기 실패: ' + (e.message || e)); }
});

// ---------- 뷰어 탭 ----------
function setViewerTab(tab) {
  document.querySelectorAll('.vtab').forEach((el) => el.classList.toggle('active', el.dataset.vtab === tab));
  viewer.showTab(tab);
}
document.querySelectorAll('.vtab').forEach((el) => {
  el.addEventListener('click', () => setViewerTab(el.dataset.vtab));
});

// ---------- 패널 리사이즈 ----------
setupGutters();
function setupGutters() {
  const root = document.documentElement;
  document.querySelectorAll('.gutter').forEach((g) => {
    g.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const which = g.dataset.gutter;
      const varName = which === 'tree' ? '--w-tree' : '--w-editor';
      const startX = e.clientX;
      const start = parseInt(getComputedStyle(root).getPropertyValue(varName));
      const onMove = (ev) => {
        const w = Math.max(160, Math.min(760, start + (ev.clientX - startX)));
        root.style.setProperty(varName, w + 'px');
      };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.cursor = ''; };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
    });
  });
}

// ---------- 드래그앤드롭 ----------
setupDragDrop();
async function setupDragDrop() {
  const overlay = document.getElementById('drop-overlay');
  if (isTauri) {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    getCurrentWebview().onDragDropEvent(async (event) => {
      const t = event.payload.type;
      if (t === 'over' || t === 'enter') overlay.classList.add('show');
      else if (t === 'leave') overlay.classList.remove('show');
      else if (t === 'drop') {
        overlay.classList.remove('show');
        const paths = (event.payload.paths || []).filter(isSpecFile);
        for (const p of paths) {
          try { openContent({ path: p, name: baseName(p), content: await readTextFile(p) }); }
          catch (e) { console.error(e); }
        }
      }
    });
  } else {
    window.addEventListener('dragover', (e) => { e.preventDefault(); overlay.classList.add('show'); });
    window.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) overlay.classList.remove('show'); });
    window.addEventListener('drop', async (e) => {
      e.preventDefault(); overlay.classList.remove('show');
      for (const file of Array.from(e.dataTransfer?.files || [])) {
        if (!isSpecFile(file.name)) continue;
        openContent({ path: file.name, name: file.name, content: await file.text() });
      }
    });
  }
}

// ---------- 키보드 단축키 ----------
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === 's') { e.preventDefault(); doSave(); }
});

// ---------- 초기 로드: 예시 스펙 ----------
openContent({ path: SAMPLE_NAME, name: SAMPLE_NAME, content: SAMPLE_YAML });

// ---------- 아이콘 ----------
function ic(name, size = 16) {
  const s = size;
  const p = {
    file: '<path d="M14 3v5h5"/><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/>',
    export: '<path d="M12 3v12M8 11l4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    upload: '<path d="M12 15V3M8 7l4-4 4 4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    layers: '<path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
    doc: '<path d="M14 3v5h5"/><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M9 13h6M9 17h6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  }[name] || '';
  const fill = name === 'folder' ? '#e8b64a' : 'none';
  const stroke = name === 'folder' ? '#c99a2e' : 'currentColor';
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
