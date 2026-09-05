// 파일 입출력: Tauri 환경이면 네이티브 다이얼로그/FS, 아니면 브라우저 폴백(개발·미리보기용).

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
// macOS 저장 패널은 확장자 필터(allowedFileTypes)가 걸리면 이름칸의 확장자를 숨겨 버려
// 사용자가 무엇으로 저장되는지 알 수 없다. 저장/내보내기 패널에서는 필터를 빼고
// (확장자는 ensureExt 로 보장) 열기 패널에만 필터를 건다.
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent || '');
const saveFilters = (filters) => (isMac ? undefined : filters);

const SPEC_EXTS = ['yaml', 'yml', 'json'];

export function extOf(path) {
  const m = /\.([^.\\/]+)$/.exec(path || '');
  return m ? m[1].toLowerCase() : '';
}
export function baseName(path) {
  return (path || '').split(/[\\/]/).pop();
}
// 저장 다이얼로그가 확장자 없는 경로를 돌려줄 때 대비해 강제로 붙인다.
function ensureExt(path, exts) {
  if (!path) return path;
  return exts.includes(extOf(path)) ? path : `${path}.${exts[0]}`;
}
export function isSpecFile(path) {
  return SPEC_EXTS.includes(extOf(path));
}
// 디스크에 바로 덮어쓸 수 있는 실제 경로인지 (절대 경로만 인정).
// 내장 예시('example.yaml')·브라우저 폴백('(선택한 파일)') 같은 가짜 경로를 걸러낸다.
export function isRealPath(path) {
  return typeof path === 'string' && /^(\/|[A-Za-z]:[\\/])/.test(path);
}

// ---- 파일 열기 ----
export async function openFileDialog() {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const selected = await open({
      multiple: false,
      filters: [{ name: 'OpenAPI', extensions: SPEC_EXTS }],
    });
    if (!selected) return null;
    const path = Array.isArray(selected) ? selected[0] : selected;
    const content = await readTextFile(path);
    return { path, name: baseName(path), content };
  }
  // 브라우저 폴백
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yaml,.yml,.json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const content = await f.text();
      resolve({ path: f.name, name: f.name, content });
    };
    input.click();
  });
}

// ---- 폴더 열기 → 중첩 트리 ----
// 트리 노드: 폴더 { name, path, isDir:true, children[] }
//            파일 { name, path, isDir:false, ext, isSpec, content? }
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-app', 'target', '.svn', '.idea']);

function fileNode(name, path, content) {
  return { name, path, isDir: false, ext: extOf(name), isSpec: isSpecFile(name), ...(content != null ? { content } : {}) };
}

export async function openFolderDialog() {
  if (!isTauri) {
    // 브라우저에서는 폴더 구조를 얻을 수 없어 다중 파일 선택으로 대체 (평면)
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.yaml,.yml,.json';
      input.multiple = true;
      input.onchange = async () => {
        const files = Array.from(input.files || []);
        if (!files.length) return resolve(null);
        const children = [];
        for (const f of files) children.push(fileNode(f.name, f.name, await f.text()));
        resolve({ dir: '(선택한 파일)', root: { name: '선택한 파일', path: '(선택한 파일)', isDir: true, children } });
      };
      input.click();
    });
  }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { readDir } = await import('@tauri-apps/plugin-fs');
  // recursive: 하위 폴더까지 훑으므로 선택한 폴더 전체를 fs 스코프에 허용시킨다.
  const dir = await open({ directory: true, multiple: false, recursive: true });
  if (!dir) return null;
  const children = await walkTree(dir, readDir, 0);
  return { dir, root: { name: baseName(dir) || dir, path: dir, isDir: true, children } };
}

async function walkTree(dir, readDir, depth) {
  if (depth > 6) return [];
  let items;
  try { items = await readDir(dir); } catch { return []; }
  const dirs = [], files = [];
  for (const it of items) {
    if (it.name.startsWith('.') || SKIP_DIRS.has(it.name)) continue;
    const child = `${dir}/${it.name}`;
    if (it.isDirectory) {
      dirs.push({ name: it.name, path: child, isDir: true, children: await walkTree(child, readDir, depth + 1) });
    } else {
      files.push(fileNode(it.name, child));
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return [...dirs, ...files];
}

// 트리에서 첫 스펙 파일 찾기 (폴더 열면 자동 선택용)
export function firstSpecNode(node) {
  if (!node) return null;
  if (!node.isDir) return node.isSpec ? node : null;
  for (const c of node.children || []) {
    const found = firstSpecNode(c);
    if (found) return found;
  }
  return null;
}

export async function readFile(path) {
  if (!isTauri) throw new Error('브라우저 모드에서는 경로로 직접 읽을 수 없습니다.');
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  return readTextFile(path);
}

// ---- 저장 ----
export async function saveFile(path, content) {
  if (isTauri) {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, content);
    return path;
  }
  downloadBrowser(baseName(path) || 'spec.yaml', content, 'text/yaml');
  return path;
}

export async function saveAsDialog(defaultName, content) {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    let path = await save({
      defaultPath: defaultName,
      filters: saveFilters([{ name: 'OpenAPI', extensions: ['yaml', 'yml', 'json'] }]),
    });
    if (!path) return null;
    path = ensureExt(path, ['yaml', 'yml', 'json']);
    await writeTextFile(path, content);
    return path;
  }
  downloadBrowser(defaultName, content, 'text/yaml');
  return defaultName;
}

// ---- 내보내기 (YAML / JSON / HTML) ----
const EXPORT_FILTERS = {
  yaml: { name: 'YAML', extensions: ['yaml', 'yml'] },
  json: { name: 'JSON', extensions: ['json'] },
  html: { name: 'HTML', extensions: ['html'] },
};
const EXPORT_MIME = { yaml: 'text/yaml', json: 'application/json', html: 'text/html' };

export async function exportAs(defaultName, content, fmt) {
  const filter = EXPORT_FILTERS[fmt] || { name: 'File', extensions: [fmt] };
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    let path = await save({ defaultPath: defaultName, filters: saveFilters([filter]) });
    if (!path) return null;
    path = ensureExt(path, filter.extensions);
    await writeTextFile(path, content);
    return path;
  }
  downloadBrowser(defaultName, content, EXPORT_MIME[fmt] || 'text/plain');
  return defaultName;
}

function downloadBrowser(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
