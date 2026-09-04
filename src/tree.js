import { extOf } from './fileio.js';

const svgChevron = `<span class="chev"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>`;
const svgFolder = `<svg width="15" height="15" viewBox="0 0 24 24" fill="#e8b64a" stroke="#c99a2e" stroke-width="1"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;

function extBadge(name) {
  const e = extOf(name);
  if (e === 'json') return `<span class="badge-ext json">{ }</span>`;
  return `<span class="badge-ext yaml">Y</span>`;
}

// files: [{ path, name, dir }]  → dir 별로 그룹핑해서 렌더
export function renderTree(el, { files, activePath, dirtyPaths, folderName }, { onSelect }) {
  el.innerHTML = '';

  const groups = new Map();
  for (const f of files) {
    const key = f.dir || folderName || '열린 파일';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }

  for (const [dir, items] of groups) {
    const folder = document.createElement('div');
    folder.className = 'row folder';
    folder.innerHTML = `${svgChevron}${svgFolder}<span class="name">${escapeHtml(shortDir(dir))}</span>`;
    el.appendChild(folder);

    const list = document.createElement('div');
    list.className = 'folder-body';
    el.appendChild(list);

    folder.addEventListener('click', () => {
      folder.classList.toggle('collapsed');
      list.classList.toggle('hidden');
    });

    for (const f of items) {
      const row = document.createElement('div');
      row.className = 'row file' + (f.path === activePath ? ' active' : '');
      const dirty = dirtyPaths?.has(f.path);
      row.innerHTML = `${extBadge(f.name)}<span class="name">${escapeHtml(f.name)}</span>${dirty ? '<span class="dirty-dot"></span>' : ''}`;
      row.title = f.path;
      row.addEventListener('click', () => onSelect(f));
      list.appendChild(row);
    }
  }
}

function shortDir(dir) {
  if (!dir) return '열린 파일';
  const parts = dir.split(/[\\/]/).filter(Boolean);
  return parts.slice(-1)[0] || dir;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
