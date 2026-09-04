import { isTauri } from './fileio.js';

// GitHub Release 기반 자동 업데이트.
// silent=true: 업데이트가 있을 때만 사용자에게 물어봄(시작 시 자동 확인용).
export async function checkForUpdate({ silent = false } = {}) {
  if (!isTauri) {
    if (!silent) alert('업데이트 확인은 설치된 앱에서만 가능합니다.');
    return;
  }
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      if (!silent) alert('현재 최신 버전입니다.');
      return;
    }
    const notes = (update.body || '').trim();
    const ok = confirm(
      `새 버전 v${update.version} 이(가) 있습니다. 지금 설치할까요?` +
      (notes ? `\n\n${notes}` : '')
    );
    if (!ok) return;
    await update.downloadAndInstall();
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (e) {
    console.error('update check failed', e);
    if (!silent) alert('업데이트 확인 실패: ' + (e.message || e));
  }
}
