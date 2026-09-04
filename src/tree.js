// 중첩 폴더 트리 렌더링.
// 노드: 폴더 { name, path, isDir:true, children[] } / 파일 { name, path, isDir:false, ext, isSpec }

const collapsed = new Set(); // 접힌 폴더 path

const svgChevron = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
const svgFolder = `<svg viewBox="0 0 24 24" width="15" height="15" fill="#e8b64a" stroke="#c99a2e" stroke-width="1"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
const svgFolderOpen = svgFolder;
const svgFileOther = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#b8b1a8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v5h5"/><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>`;

function extBadge(node) {
  if (node.ext === 'yaml' || node.ext === 'yml') return `<span class="badge-ext yaml">Y</span>`;
  if (node.ext === 'json') return `<span class="badge-ext json">{ }</span>`;
  return svgFileOther;
}

// hideNonSpec=true 일 때 스펙 파일이 하나도 없는 폴더/비스펙 파일은 숨긴다.
function isVisible(node, hideNonSpec) {
  if (!hideNonSpec) return true;
  if (node.isDir) return (node.children || []).some((c) => isVisible(c, true));
  return node.isSpec;
}

export function renderTree(el, { root, activePath, dirtyPaths, hideNonSpec }, { onSelect }) {
  el.innerHTML = '';
  const ctx = { activePath, dirtyPaths, hideNonSpec, onSelect, rerender: () => renderTree(el, { root, activePath, dirtyPaths, hideNonSpec }, { onSelect }) };
  const frag = document.createDocumentFragment();
  // 루트의 자식들을 depth 0 부터 렌더 (루트 폴더 자체는 생략해 공간 절약)
  for (const child of root.children || []) renderNode(child, 0, ctx, frag);
  if (!frag.childNodes.length) {
    el.innerHTML = `<div class="tree-hint">표시할 파일이 없습니다.</div>`;
    return;
  }
  el.appendChild(frag);
}

function renderNode(node, depth, ctx, frag) {
  if (!isVisible(node, ctx.hideNonSpec)) return;
  const row = document.createElement('div');
  const pad = 8 + depth * 14;

  if (node.isDir) {
    const isCol = collapsed.has(node.path);
    row.className = 'row folder' + (isCol ? ' collapsed' : '');
    row.style.paddingLeft = pad + 'px';
    row.innerHTML = `<span class="chev">${svgChevron}</span>${isCol ? svgFolder : svgFolderOpen}<span class="name">${esc(node.name)}</span>`;
    row.addEventListener('click', () => {
      if (collapsed.has(node.path)) collapsed.delete(node.path); else collapsed.add(node.path);
      ctx.rerender();
    });
    frag.appendChild(row);
    if (!isCol) for (const c of node.children || []) renderNode(c, depth + 1, ctx, frag);
  } else {
    const active = node.path === ctx.activePath;
    const dirty = ctx.dirtyPaths?.has(node.path);
    row.className = 'row file' + (active ? ' active' : '') + (node.isSpec ? '' : ' disabled');
    row.style.paddingLeft = pad + 8 + 'px';
    const dot = dirty ? '<span class="dirty-dot"></span>' : active ? '<span class="tab-dot"></span>' : '';
    row.innerHTML = `${extBadge(node)}<span class="name">${esc(node.name)}</span>${dot}`;
    row.title = node.isSpec ? node.path : `${node.name} (지원하지 않는 형식)`;
    if (node.isSpec) row.addEventListener('click', () => ctx.onSelect(node));
    frag.appendChild(row);
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
