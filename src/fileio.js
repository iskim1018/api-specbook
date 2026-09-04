// 파일 입출력: Tauri 환경이면 네이티브 다이얼로그/FS, 아니면 브라우저 폴백(개발·미리보기용).

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const SPEC_EXTS = ['yaml', 'yml', 'json'];

export function extOf(path) {
  const m = /\.([^.\\/]+)$/.exec(path || '');
  return m ? m[1].toLowerCase() : '';
}
export function baseName(path) {
  return (path || '').split(/[\\/]/).pop();
}
export function isSpecFile(path) {
  return SPEC_EXTS.includes(extOf(path));
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

// ---- 폴더 열기 → spec 파일 목록 ----
export async function openFolderDialog() {
  if (!isTauri) {
    // 브라우저에서는 폴더 트리 대신 다중 파일 선택으로 대체
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.yaml,.yml,.json';
      input.multiple = true;
      input.onchange = async () => {
        const files = Array.from(input.files || []);
        if (!files.length) return resolve(null);
        const entries = [];
        for (const f of files) entries.push({ path: f.name, name: f.name, content: await f.text() });
        resolve({ dir: '(선택한 파일)', entries });
      };
      input.click();
    });
  }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { readDir, readTextFile } = await import('@tauri-apps/plugin-fs');
  const dir = await open({ directory: true, multiple: false });
  if (!dir) return null;
  const entries = [];
  await walk(dir, entries, readDir, readTextFile, 0);
  return { dir, entries };
}

async function walk(dir, out, readDir, readTextFile, depth) {
  if (depth > 4) return;
  let items;
  try { items = await readDir(dir); } catch { return; }
  for (const it of items) {
    const child = `${dir}/${it.name}`;
    if (it.isDirectory) {
      await walk(child, out, readDir, readTextFile, depth + 1);
    } else if (isSpecFile(it.name)) {
      out.push({ path: child, name: it.name, dir });
    }
  }
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
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: 'OpenAPI', extensions: ['yaml', 'yml', 'json'] }],
    });
    if (!path) return null;
    await writeTextFile(path, content);
    return path;
  }
  downloadBrowser(defaultName, content, 'text/yaml');
  return defaultName;
}

// ---- 내보내기 (HTML) ----
export async function exportHtml(defaultName, html) {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (!path) return null;
    await writeTextFile(path, html);
    return path;
  }
  downloadBrowser(defaultName, html, 'text/html');
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
