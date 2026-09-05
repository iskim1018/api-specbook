import { isTauri } from './fileio.js';

// GitHub Release 기반 자동 업데이트.
// 알림 → 사용자 승인 → 진행률 → 원할 때 재시작. 모두 앱 안 배너에서 처리하고
// alert/confirm 처럼 화면을 막지 않는다.
//
// deps 는 main.js 가 initUpdater 로 넘긴다.
//   getDirtyFiles() : 저장하지 않은 파일 목록
//   confirmDiscard(): 미저장 변경을 버려도 되는지 사용자에게 확인 (true 일 때만 진행)
//   showToast(msg, opt)
const deps = {
  getDirtyFiles: () => [],
  confirmDiscard: async () => true,
  showToast: () => {},
};

let currentVersion = '';

export function initUpdater(opts = {}) {
  Object.assign(deps, opts);
}

// ---------- 공용 ----------
function bannerEl() { return document.getElementById('update-banner'); }

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// 업데이트가 있다는 사실은 배너를 닫아도 툴바 버튼의 점으로 남겨 둔다.
function setBadge(on) {
  const btn = document.getElementById('btn-update');
  if (!btn) return;
  const dot = btn.querySelector('.badge-dot');
  if (on && !dot) {
    const d = document.createElement('span');
    d.className = 'badge-dot';
    btn.appendChild(d);
  } else if (!on && dot) {
    dot.remove();
  }
}

function hideBanner() {
  const n = bannerEl();
  if (!n) return;
  n.className = 'update-banner hidden';
  n.innerHTML = '';
}

function dismissedVersion() {
  try { return localStorage.getItem('updateDismissed'); } catch { return null; }
}

async function getCurrentVersion() {
  if (currentVersion) return currentVersion;
  if (!isTauri) return (currentVersion = 'dev');
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    currentVersion = await getVersion();
  } catch { currentVersion = '?'; }
  return currentVersion;
}

// ---------- 업데이트 확인 ----------
// silent=true: 시작 시 자동 확인. 사용자가 '나중에' 를 누른 버전은 다시 알리지 않는다.
export async function checkForUpdate({ silent = false } = {}) {
  if (!isTauri) {
    if (!silent) deps.showToast('업데이트 확인은 설치된 앱에서만 가능합니다.', { kind: 'error' });
    return;
  }
  const current = await getCurrentVersion();
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      setBadge(false);
      if (!silent) deps.showToast(`현재 최신 버전입니다 (v${current})`);
      return;
    }
    setBadge(true);
    if (silent && dismissedVersion() === update.version) return;
    showBanner(update, current);
  } catch (e) {
    console.error('update check failed', e);
    if (!silent) deps.showToast('업데이트 확인 실패: ' + (e.message || e), { kind: 'error' });
  }
}

// ---------- 배너: 새 버전 있음 ----------
function showBanner(update, current) {
  const n = bannerEl();
  if (!n) return;
  n.className = 'update-banner';
  n.innerHTML = `
    <div class="ub-main">
      <span class="ub-text">새 버전 <b>v${esc(update.version)}</b> 이(가) 있습니다 (현재 v${esc(current)})</span>
      <div class="ub-actions">
        <button class="ub-btn primary" data-act="install">업데이트</button>
        <button class="ub-btn" data-act="later">나중에</button>
        <button class="ub-btn" data-act="notes">자세히</button>
      </div>
    </div>
    <div class="ub-progress hidden"><div class="ub-bar"></div></div>
    <pre class="ub-notes hidden"></pre>
  `;
  // 릴리스 노트는 서버에서 온 문자열이므로 반드시 텍스트로만 넣는다.
  n.querySelector('.ub-notes').textContent = (update.body || '').trim() || '릴리스 노트가 없습니다.';

  n.querySelector('[data-act="notes"]').addEventListener('click', () => {
    n.querySelector('.ub-notes').classList.toggle('hidden');
  });
  n.querySelector('[data-act="later"]').addEventListener('click', () => {
    try { localStorage.setItem('updateDismissed', update.version); } catch {}
    hideBanner();
  });
  n.querySelector('[data-act="install"]').addEventListener('click', () => install(n, update));
}

// ---------- 내려받기 + 설치 ----------
async function install(n, update) {
  const text = n.querySelector('.ub-text');
  const actions = n.querySelector('.ub-actions');
  const progress = n.querySelector('.ub-progress');
  const bar = n.querySelector('.ub-bar');
  const original = text.innerHTML;
  const buttons = [...actions.querySelectorAll('button')];

  buttons.forEach((b) => { b.disabled = true; });
  progress.classList.remove('hidden');
  bar.style.width = '0%';

  let total = 0;
  let got = 0;
  try {
    await update.downloadAndInstall((ev) => {
      if (ev.event === 'Started') {
        total = ev.data?.contentLength || 0;
        got = 0;
        // 전체 크기를 모르면 퍼센트 대신 흐르는 막대로 보여 준다.
        bar.classList.toggle('indeterminate', !total);
        bar.style.width = total ? '0%' : '';
        text.textContent = total ? '다운로드 중… 0%' : '다운로드 중…';
      } else if (ev.event === 'Progress') {
        got += ev.data?.chunkLength || 0;
        if (total) {
          const pct = Math.min(100, Math.round((got / total) * 100));
          bar.style.width = pct + '%';
          text.textContent = `다운로드 중… ${pct}%`;
        }
      } else if (ev.event === 'Finished') {
        bar.classList.remove('indeterminate');
        bar.style.width = '100%';
        text.textContent = '설치 중…';
      }
    });
    showInstalled(n);
  } catch (e) {
    console.error('update install failed', e);
    deps.showToast('업데이트 실패: ' + (e.message || e), { kind: 'error' });
    progress.classList.add('hidden');
    bar.classList.remove('indeterminate');
    text.innerHTML = original;
    buttons.forEach((b) => { b.disabled = false; });
  }
}

// ---------- 배너: 설치 완료 ----------
function showInstalled(n) {
  n.querySelector('.ub-progress').classList.add('hidden');
  n.querySelector('.ub-notes').classList.add('hidden');
  n.querySelector('.ub-text').textContent = '설치 완료 — 다시 시작하면 새 버전이 적용됩니다';
  const actions = n.querySelector('.ub-actions');
  actions.innerHTML = `
    <button class="ub-btn primary" data-act="restart">지금 다시 시작</button>
    <button class="ub-btn" data-act="dismiss">나중에</button>
  `;
  actions.querySelector('[data-act="dismiss"]').addEventListener('click', hideBanner);
  actions.querySelector('[data-act="restart"]').addEventListener('click', async () => {
    // 저장하지 않은 파일이 있으면 사용자가 확인해야 재시작한다.
    if (deps.getDirtyFiles().length && !(await deps.confirmDiscard())) return;
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      console.error('relaunch failed', e);
      deps.showToast('다시 시작 실패: ' + (e.message || e), { kind: 'error' });
    }
  });
}

// ---------- 개발용 미리보기 ----------
// 브라우저(npm run dev)에서 배너 UI 를 확인하기 위한 가짜 업데이트. 프로덕션 빌드에는 포함되지 않는다.
export function showUpdateBannerPreview({ version = '9.9.9', body = '' } = {}) {
  const fake = {
    version,
    body,
    downloadAndInstall(onEvent) {
      return new Promise((resolve) => {
        const total = 8 * 1024 * 1024;
        const chunk = total / 20;
        let sent = 0;
        onEvent({ event: 'Started', data: { contentLength: total } });
        const timer = setInterval(() => {
          sent += chunk;
          onEvent({ event: 'Progress', data: { chunkLength: chunk } });
          if (sent >= total) {
            clearInterval(timer);
            onEvent({ event: 'Finished' });
            setTimeout(resolve, 300);
          }
        }, 100);
      });
    },
  };
  setBadge(true);
  showBanner(fake, currentVersion || 'dev');
}
