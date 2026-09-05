import './style.css';
import logoUrl from './assets/logo.png';
import yaml from 'js-yaml';
import { buildModel } from '../core/model.mjs';
import { renderHtml } from '../core/render.mjs';
import { parseSpec } from './parse.js';
import { createEditor } from './editor.js';
import { createViewer } from './viewer.js';
import { renderTree } from './tree.js';
import {
  isTauri, isMac, extOf, baseName, isSpecFile, isRealPath,
  openFileDialog, openFolderDialog, readFile, saveFile, saveAsDialog, exportAs, firstSpecNode,
} from './fileio.js';
import { SAMPLE_NAME, SAMPLE_YAML } from './sample.js';
import { initUpdater, checkForUpdate, showUpdateBannerPreview } from './updater.js';

// 단축키 표기 (툴팁용)
const MOD = isMac ? '⌘' : 'Ctrl+';
const SHIFT = isMac ? '⇧' : 'Shift+';

// ---------- 앱 셸 ----------
const app = document.getElementById('app');
app.innerHTML = `
<div class="app-shell">
  <div class="toolbar">
    <img class="brand" src="${logoUrl}" alt="Specbook" title="API Specbook" />
    <div class="tb-sep"></div>
    <div class="tb-group">
      <button class="btn" id="btn-open">${ic('file')}파일 열기</button>
      <button class="btn" id="btn-folder">${ic('folder')}폴더 열기</button>
      <button class="btn" id="btn-save">${ic('save')}저장</button>
    </div>
    <div class="tb-sep"></div>
    <div class="export-wrap">
      <button class="btn primary" id="btn-export">${ic('export')}내보내기${ic('chevron', 13)}</button>
      <div class="export-menu hidden" id="export-menu">
        <button class="export-item" data-fmt="yaml">${ic('file')}<span class="ex-txt"><b>YAML로 저장</b><em>편집 중인 스펙 (.yaml)</em></span></button>
        <button class="export-item" data-fmt="json">${ic('file')}<span class="ex-txt"><b>JSON으로 저장</b><em>스펙을 JSON으로 변환 (.json)</em></span></button>
        <button class="export-item" data-fmt="html">${ic('doc')}<span class="ex-txt"><b>HTML 문서로 내보내기</b><em>표 중심 명세서 (.html)</em></span></button>
      </div>
    </div>
    <div class="tb-spacer"></div>
    <div class="tb-group panel-toggles">
      <button class="icon-btn" id="btn-toggle-tree" aria-pressed="true" title="탐색기 (${MOD}B)">${ic('panelLeft', 17)}</button>
      <button class="icon-btn" id="btn-toggle-editor" aria-pressed="true" title="에디터 (${MOD}${SHIFT}E)">${ic('code', 17)}</button>
      <button class="icon-btn" id="btn-toggle-viewer" aria-pressed="true" title="미리보기 (${MOD}${SHIFT}V)">${ic('panelRight', 17)}</button>
    </div>
    <div class="tb-sep"></div>
    <div class="status-pill ok" id="doc-status">${ic('check', 14)}<span>정상</span></div>
    <button class="icon-btn" id="btn-update" title="업데이트 확인">${ic('refresh', 17)}</button>
    <button class="icon-btn" id="btn-theme" title="라이트 / 다크 전환">${ic('moon', 17)}</button>
  </div>

  <div class="update-banner hidden" id="update-banner"></div>

  <div class="body">
    <!-- 탐색기 -->
    <div class="panel explorer">
      <div class="panel-head">
        <span class="panel-title">탐색기</span>
        <label class="spec-toggle" title="스펙(YAML·JSON) 파일만 표시"><input type="checkbox" id="hide-nonspec"><span>스펙만</span></label>
      </div>
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
      <div class="panel-head" style="padding:0 10px 0 0;">
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
const openFiles = new Map(); // path -> { path, name, ext, content, saved(마지막 저장 내용), dirty }
let treeRoot = null;         // 폴더 열기로 얻은 트리 루트 노드
let folderName = null;
let activePath = null;
let hideNonSpec = false;     // 스펙(YAML·JSON) 파일만 표시
// 문서(HTML) 미리보기 테마는 앱 테마를 따른다 (내보내기는 공유용이므로 항상 라이트)
const docTheme = () => (appTheme === 'dark' ? 'dark' : 'editorial');
let appTheme = loadAppTheme(); // 'light' | 'dark'
const panels = loadPanels();   // { tree, editor, viewer } — 표시 중인 패널

function loadAppTheme() {
  try { const s = localStorage.getItem('appTheme'); if (s === 'light' || s === 'dark') return s; } catch {}
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function applyAppTheme(t, updateEditor = true) {
  appTheme = t;
  document.documentElement.dataset.theme = t;
  const btn = document.getElementById('btn-theme');
  if (btn) btn.innerHTML = ic(t === 'dark' ? 'sun' : 'moon', 17);
  if (updateEditor) { editor.setTheme(t === 'dark'); updatePreview(); } // 문서 미리보기도 같은 테마로
  try { localStorage.setItem('appTheme', t); } catch {}
}
// 인스턴스 생성 전에 data-theme·버튼만 반영 (에디터는 아래에서 dark 옵션으로)
applyAppTheme(appTheme, false);

// ---------- 인스턴스 ----------
const viewer = createViewer(document.getElementById('viewer-body'));
const editor = createEditor(document.getElementById('cm-host'), {
  ext: 'yaml',
  doc: '',
  dark: appTheme === 'dark',
  onChange: onEditorChange,
  onCursor: ({ line, col }) => { document.getElementById('sb-pos').textContent = `줄 ${line}, 칸 ${col}`; },
});

document.getElementById('btn-theme').addEventListener('click', () => {
  applyAppTheme(appTheme === 'dark' ? 'light' : 'dark');
});

// ---------- 패널 토글 (탐색기 · 에디터 · 미리보기) ----------
const PANEL_ORDER = ['tree', 'editor', 'viewer'];
const PANEL_SEL = { tree: '.explorer', editor: '.editor-panel', viewer: '.viewer-panel' };
const PANEL_VAR = { tree: '--w-tree', editor: '--w-editor' };
const FLEX_MIN = 280; // 1fr 로 늘어나는 패널의 최소 폭

function loadPanels() {
  const def = { tree: true, editor: true, viewer: true };
  try {
    const s = JSON.parse(localStorage.getItem('panels') || 'null');
    if (s && typeof s === 'object') {
      const p = { tree: s.tree !== false, editor: s.editor !== false, viewer: s.viewer !== false };
      if (p.tree || p.editor || p.viewer) return p; // 전부 숨김 상태는 무시
    }
  } catch {}
  return def;
}

function visiblePanels() {
  return PANEL_ORDER.filter((k) => panels[k]);
}

// 보이는 패널만 grid 열로 만든다. 맨 오른쪽 패널이 항상 1fr 로 남는 폭을 차지한다.
function applyLayout() {
  const body = document.querySelector('.body');
  const vis = visiblePanels();
  const cols = [];
  vis.forEach((k, i) => {
    if (i) cols.push('6px');
    cols.push(i === vis.length - 1 ? '1fr' : `var(${PANEL_VAR[k]})`);
  });
  body.style.gridTemplateColumns = cols.join(' ');

  for (const k of PANEL_ORDER) {
    document.querySelector(PANEL_SEL[k]).classList.toggle('hidden', !panels[k]);
    const btn = document.getElementById(`btn-toggle-${k}`);
    btn.classList.toggle('active', panels[k]);
    btn.setAttribute('aria-pressed', String(panels[k]));
  }
  // 거터는 양쪽 패널이 모두 보일 때만 남긴다.
  document.querySelector('.gutter[data-gutter="tree"]')
    .classList.toggle('hidden', !(panels.tree && (panels.editor || panels.viewer)));
  document.querySelector('.gutter[data-gutter="editor"]')
    .classList.toggle('hidden', !(panels.editor && panels.viewer));

  editor.view.requestMeasure(); // CodeMirror 레이아웃 재측정
}

function togglePanel(which) {
  if (!PANEL_ORDER.includes(which)) return;
  // 마지막 하나 남은 패널은 숨기지 않는다 (버튼은 눌린 상태 유지)
  if (panels[which] && visiblePanels().length <= 1) return;
  panels[which] = !panels[which];
  try { localStorage.setItem('panels', JSON.stringify(panels)); } catch {}
  applyLayout();
}

for (const k of PANEL_ORDER) {
  document.getElementById(`btn-toggle-${k}`).addEventListener('click', () => togglePanel(k));
}
applyLayout();

// ---------- 미리보기 갱신 ----------
let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 300);
}

function updatePreview() {
  const f = activePath ? openFiles.get(activePath) : null;
  const errChip = document.getElementById('err-chip');
  const sbValid = document.getElementById('sb-valid');
  const docStatus = document.getElementById('doc-status');
  if (!f) {
    // 마지막 탭을 닫은 뒤 이전 파일의 오류 표시가 남지 않도록 중립 상태로 되돌린다
    errChip.className = 'err-chip hidden';
    sbValid.className = 'valid idle';
    sbValid.innerHTML = '<span class="dot"></span>파일 없음';
    docStatus.className = 'status-pill idle';
    docStatus.innerHTML = `${ic('file', 14)}<span>파일 없음</span>`;
    return;
  }
  const { doc, error } = parseSpec(f.content, f.ext);

  if (error) {
    errChip.className = 'err-chip';
    errChip.innerHTML = `${ic('alert', 15)}<span><b>줄 ${error.line}</b> · ${escapeHtml(error.message)}</span>`;
    sbValid.className = 'valid err';
    sbValid.innerHTML = '<span class="dot"></span>구문 오류';
    docStatus.className = 'status-pill err';
    docStatus.innerHTML = `${ic('alert', 14)}<span>오류 발견</span>`;
    return;
  }

  errChip.className = 'err-chip hidden';
  sbValid.className = 'valid ok';
  sbValid.innerHTML = '<span class="dot"></span>정상';
  docStatus.className = 'status-pill ok';
  docStatus.innerHTML = `${ic('check', 14)}<span>정상</span>`;

  try {
    const model = buildModel(doc);
    const html = renderHtml(model, { theme: docTheme() });
    viewer.setContent({ html, spec: doc });
    // 문서는 만들어졌지만 없는 $ref 등 경고가 있으면 오류와 구분해 알려 준다
    const warnings = model.warnings || [];
    if (warnings.length) {
      errChip.className = 'err-chip warn';
      errChip.innerHTML = `${ic('alert', 15)}<span><b>경고 ${warnings.length}건</b>\n${warnings.map((w) => escapeHtml(w)).join('\n')}</span>`;
      sbValid.className = 'valid warn';
      sbValid.innerHTML = `<span class="dot"></span>경고 ${warnings.length}건`;
      docStatus.className = 'status-pill warn';
      docStatus.innerHTML = `${ic('alert', 14)}<span>경고 ${warnings.length}건</span>`;
    }
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
    // 마지막 저장(또는 열기) 시점과 같아지면(Cmd+Z 로 되돌림 등) 수정 표시를 지운다
    const dirty = text !== f.saved;
    if (dirty !== f.dirty) { f.dirty = dirty; renderTabs(); refreshTree(); }
  }
  schedulePreview();
}

// ---------- 파일/탭 관리 ----------
function openContent({ path, name, content }) {
  const ext = extOf(name) || 'yaml';
  const existing = openFiles.get(path);
  if (existing) { activate(path); return; }
  openFiles.set(path, { path, name, ext, content, saved: content, dirty: false });
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
    else { activePath = null; editor.setDoc('', 'yaml'); viewer.clear(); renderTabs(); updatePreview(); }
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
    const isActive = f.path === activePath;
    tab.className = 'tab' + (isActive ? ' active' : '');
    const dot = f.dirty ? '<span class="dirty-dot"></span>' : '';
    tab.innerHTML =
      dot +
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
  let root = treeRoot;
  // 폴더를 안 열었으면, 열린 파일들을 평면 트리로 보여준다.
  if (!root) {
    const children = [...openFiles.values()].map((f) => ({ name: f.name, path: f.path, isDir: false, ext: f.ext, isSpec: true }));
    root = children.length ? { name: '열린 파일', path: '__open__', isDir: true, children } : null;
  }
  if (!root) {
    el.innerHTML = `<div class="tree-empty">${ic('folder', 34)}<span>아직 열린 파일이 없습니다.<br>파일 또는 폴더를 여세요.</span></div>`;
    return;
  }
  const dirtyPaths = new Set([...openFiles.values()].filter((f) => f.dirty).map((f) => f.path));
  renderTree(el, { root, activePath, dirtyPaths, hideNonSpec }, { onSelect: selectTreeFile });
}

// ---------- 툴바 동작 ----------
document.getElementById('btn-open').addEventListener('click', async () => {
  const r = await openFileDialog();
  if (r) openContent(r);
});

document.getElementById('btn-folder').addEventListener('click', async () => {
  const r = await openFolderDialog();
  if (!r) return;
  treeRoot = r.root;
  folderName = r.dir;
  refreshTree();
  const first = firstSpecNode(treeRoot);
  if (first) selectTreeFile(first);
});

document.getElementById('hide-nonspec').addEventListener('change', (e) => {
  hideNonSpec = e.target.checked;
  refreshTree();
});

document.getElementById('btn-save').addEventListener('click', doSave);
async function doSave() {
  const f = activePath ? openFiles.get(activePath) : null;
  if (!f) return;
  try {
    // 실제 절대 경로일 때만 덮어쓰기, 아니면(내장 예시·브라우저 폴백) 다른 이름으로 저장
    if (isTauri && isRealPath(f.path)) {
      await saveFile(f.path, f.content);
    } else {
      const saved = await saveAsDialog(f.name, f.content);
      if (!saved) return;            // 사용자가 취소 → dirty 유지
      if (saved !== f.path) rekeyFile(f, saved);
    }
    f.saved = f.content; f.dirty = false; renderTabs(); refreshTree();
  } catch (e) { alert('저장 실패: ' + (e.message || e)); }
}

// 다른 이름으로 저장 후 openFiles 키와 파일 정보를 새 경로로 옮긴다.
function rekeyFile(f, newPath) {
  const oldPath = f.path;
  openFiles.delete(oldPath);
  f.path = newPath;
  f.name = baseName(newPath) || newPath;
  f.ext = extOf(f.name) || f.ext;
  openFiles.set(newPath, f);
  if (activePath === oldPath) {
    activePath = newPath;
    document.getElementById('sb-lang').textContent = f.ext.toUpperCase();
  }
}

// ---------- 내보내기 드롭다운 ----------
const exportBtn = document.getElementById('btn-export');
const exportMenu = document.getElementById('export-menu');
exportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  exportMenu.classList.toggle('hidden');
});
exportMenu.querySelectorAll('.export-item').forEach((it) => {
  it.addEventListener('click', () => {
    exportMenu.classList.add('hidden');
    exportSpec(it.dataset.fmt);
  });
});
document.addEventListener('click', () => exportMenu.classList.add('hidden'));

// fmt: 'yaml' | 'json' | 'html'
async function exportSpec(fmt) {
  const f = activePath ? openFiles.get(activePath) : null;
  if (!f) return;
  const { doc, error } = parseSpec(f.content, f.ext);
  if (error) { alert('문서에 오류가 있어 내보낼 수 없습니다: ' + error.message); return; }
  const stem = f.name.replace(/\.(ya?ml|json)$/i, '');
  let content, outName;
  try {
    if (fmt === 'html') {
      content = renderHtml(buildModel(doc), { theme: 'editorial' });
      outName = stem + '.html';
    } else if (fmt === 'json') {
      // 이미 JSON이면 원본 유지, 아니면 변환
      content = f.ext === 'json' ? f.content : JSON.stringify(doc, null, 2);
      outName = stem + '.json';
    } else { // yaml
      // 이미 YAML이면 주석·서식 보존 위해 원본 유지, 아니면 변환
      content = f.ext === 'json' ? yaml.dump(doc, { lineWidth: -1, noRefs: true }) : f.content;
      outName = stem + '.yaml';
    }
    await exportAs(outName, content, fmt);
  } catch (e) {
    alert('내보내기 실패: ' + (e.message || e));
  }
}

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
  const body = document.querySelector('.body');
  const MIN = 200;         // 탐색기·에디터 최소 폭

  document.querySelectorAll('.gutter').forEach((g) => {
    g.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const which = g.dataset.gutter;
      const varName = PANEL_VAR[which];
      const startX = e.clientX;
      const px = (name) => parseInt(getComputedStyle(root).getPropertyValue(name));
      const start = px(varName);

      // 드래그 동안 뷰어의 iframe/Swagger UI가 마우스 이벤트를 가로채지 못하도록
      // 전체 화면 오버레이를 덮는다 (끊김·값 튐 방지의 핵심).
      const ov = document.createElement('div');
      ov.className = 'resize-overlay';
      document.body.appendChild(ov);

      const onMove = (ev) => {
        const total = body.clientWidth;
        const vis = visiblePanels();
        const flex = vis[vis.length - 1]; // 1fr 로 늘어나는(=맨 오른쪽) 패널
        // 숨긴 패널은 폭을 차지하지 않으므로, 지금 끄는 패널을 뺀 '보이는 고정폭' 만 더한다.
        const otherFixed = vis
          .filter((k) => k !== which && k !== flex)
          .reduce((sum, k) => sum + px(PANEL_VAR[k]), 0);
        const maxW = total - otherFixed - FLEX_MIN - 6 * (vis.length - 1); // 거터 6px × 개수
        const w = Math.max(MIN, Math.min(maxW, start + (ev.clientX - startX)));
        root.style.setProperty(varName, Math.round(w) + 'px');
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        ov.remove();
        editor.view.requestMeasure(); // CodeMirror 레이아웃 재측정
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
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
        const all = event.payload.paths || [];
        const paths = all.filter(isSpecFile);
        const failed = [];
        for (const p of paths) {
          try { openContent({ path: p, name: baseName(p), content: await readTextFile(p) }); }
          catch (e) { console.error(e); failed.push(baseName(p)); }
        }
        // 조용히 무시하면 "끌어다 놨는데 아무 일도 없다"가 되므로 이유를 알려 준다.
        if (all.length && !paths.length) alert('YAML · JSON 파일만 열 수 있습니다.');
        else if (failed.length) alert(`파일을 읽지 못했습니다:\n${failed.map((n) => `· ${n}`).join('\n')}\n\n홈 · 문서 · 바탕화면 · 다운로드 폴더 밖의 파일은 '파일 열기' 로 여세요.`);
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

// ---------- 종료 가드: 저장하지 않은 변경 확인 ----------
function dirtyFiles() {
  return [...openFiles.values()].filter((f) => f.dirty);
}

// 변경 없음 → true, 있으면 사용자에게 묻고 "저장하지 않고 닫기" 를 골랐을 때만 true.
// 종료 가드와 업데이트 재시작이 함께 쓰므로 클로저 밖에 둔다.
let askingDiscard = false;
async function confirmDiscard() {
  const dirty = dirtyFiles();
  if (!dirty.length) return true;
  if (!isTauri) return true; // 브라우저 폴백: beforeunload 가 대신 막는다
  if (askingDiscard) return false; // 대화상자가 이미 떠 있으면 중복 요청 무시
  askingDiscard = true;
  try {
    const { ask } = await import('@tauri-apps/plugin-dialog');
    const names = dirty.map((f) => `· ${f.name}`).join('\n');
    return await ask(
      `저장하지 않은 변경사항이 있습니다.\n\n${names}\n\n저장하지 않고 종료할까요?`,
      { title: '종료 확인', kind: 'warning', okLabel: '저장하지 않고 닫기', cancelLabel: '취소' }
    );
  } finally { askingDiscard = false; }
}

setupCloseGuard();
async function setupCloseGuard() {
  if (isTauri) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const { listen } = await import('@tauri-apps/api/event');
    const { exit } = await import('@tauri-apps/plugin-process');
    const win = getCurrentWindow();

    // 창 닫기 버튼 / Cmd+W
    await win.onCloseRequested(async (event) => {
      if (!dirtyFiles().length) return;
      event.preventDefault(); // 사용자가 확인하기 전에는 닫지 않는다
      if (await confirmDiscard()) await win.destroy();
    });
    // Cmd+Q / 앱 메뉴 '종료': Rust 쪽(lib.rs)이 종료를 보류하고 이 이벤트를 보낸다.
    // 확인이 끝나면 exit() 로 다시 종료 요청 (code 가 있으므로 Rust 가 통과시킨다).
    await listen('app-quit-requested', async () => {
      if (await confirmDiscard()) await exit(0);
    });
    // 메뉴 '탭 닫기'(Cmd+W): 창이 아니라 활성 탭만 닫는다
    await listen('app-close-tab-requested', () => { if (activePath) closeFile(activePath); });
    // macOS 는 메뉴 단축키가 웹뷰보다 먼저 키를 가져가므로 패널 토글도 메뉴에서 받는다
    await listen('app-toggle-panel', (e) => togglePanel(e.payload));
    await listen('app-check-update', () => checkForUpdate({ silent: false }));
  } else {
    // 브라우저 폴백: 기본 이탈 확인 대화상자
    window.addEventListener('beforeunload', (e) => {
      if (!dirtyFiles().length) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }
}

// ---------- macOS 첫 클릭 유실 보완 ----------
// 한글 입력기 + 트랙패드 탭 클릭: 에디터(contenteditable)에 포커스가 있을 때 다른 요소를 탭하면
// 에디터 blur 가 UI 프로세스에 반영되기 전에 도착한 짧은 mouseUp 을 입력기가 삼켜 click 이 오지 않는다
// (pointerdown/mousedown 은 정상 도착). 그 조건에서는 pointerdown 시점에 바로 click 을 발생시키고,
// 뒤늦게 진짜 click 이 같은 요소에 오면(물리 클릭 등) 중복이므로 무시한다.
if (isTauri && isMac) {
  let synthetic = null; // { key, until }
  // 클릭 대상의 식별자: 가장 가까운 인터랙티브 요소(id 가 있으면 id). 토글 버튼처럼 내부가 재렌더돼도 같은 것으로 본다
  const clickKey = (el) => {
    const it = el.closest('button, a, .tab, .vtab, .row, .export-item, label, input, select') || el;
    return it.id ? '#' + it.id : it;
  };
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const cm = document.querySelector('.cm-content');
    if (!cm || document.activeElement !== cm || cm.contains(e.target)) return; // 에디터 안 클릭은 정상 동작
    const target = e.target;
    synthetic = { key: clickKey(target), until: performance.now() + 600 };
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, view: window }));
  }, true);
  document.addEventListener('click', (e) => {
    if (!synthetic || !e.isTrusted) return;
    if (performance.now() < synthetic.until && clickKey(e.target) === synthetic.key) { e.stopPropagation(); e.preventDefault(); }
    synthetic = null;
  }, true);
}

// ---------- 키보드 단축키 ----------
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); } // CapsLock 켜져도 동작
  // macOS 는 메뉴 단축키가 먼저 받으므로 아래는 Windows/Linux 용
  if (mod && e.key.toLowerCase() === 'w') { e.preventDefault(); if (activePath) closeFile(activePath); }
  const k = e.key.toLowerCase();
  if (mod && !e.shiftKey && k === 'b') { e.preventDefault(); togglePanel('tree'); }
  if (mod && e.shiftKey && k === 'e') { e.preventDefault(); togglePanel('editor'); }
  if (mod && e.shiftKey && k === 'v') { e.preventDefault(); togglePanel('viewer'); }
});

// ---------- 토스트 ----------
function showToast(message, { kind = 'info', ms = 3200 } = {}) {
  let host = document.querySelector('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'error' ? ' error' : '');
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
  }, ms);
}

// ---------- 초기 로드: 예시 스펙 ----------
openContent({ path: SAMPLE_NAME, name: SAMPLE_NAME, content: SAMPLE_YAML });

// ---------- 업데이트 ----------
initUpdater({ getDirtyFiles: dirtyFiles, confirmDiscard, showToast });
document.getElementById('btn-update').addEventListener('click', () => checkForUpdate({ silent: false }));
// 시작 시 자동 확인 (설치본에서만, 업데이트 있을 때만 안내)
setTimeout(() => checkForUpdate({ silent: true }), 1500);

// 개발 서버에서만: 브라우저로 배너·토스트 UI 를 확인하기 위한 훅
if (import.meta.env.DEV) {
  window.__specbookDev = { showUpdateBanner: showUpdateBannerPreview, showToast };
}

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
    check: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    panelLeft: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9.5 4v16"/>',
    code: '<path d="M9 18l-6-6 6-6M15 6l6 6-6 6"/>',
    panelRight: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14.5 4v16"/>',
    refresh: '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>',
    palette: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="15.5" cy="10" r="1"/><path d="M12 21a3 3 0 0 0 0-6 2 2 0 0 1 0-4"/>',
  }[name] || '';
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
