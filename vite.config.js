import { defineConfig } from 'vite';

// Tauri는 고정 포트를 기대한다. 개발 서버는 1420 포트로 고정한다.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // 프론트엔드 소스는 저장소 루트를 기준으로 한다 (index.html이 루트에 있음).
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      // Rust 소스 변경은 Tauri가 감시하므로 Vite 감시에서 제외한다.
      ignored: ['**/src-tauri/**'],
    },
  },
  // 산출물은 Tauri가 번들할 dist/app 으로 보낸다 (dist/ 는 CLI 샘플 출력과 공유되므로 하위 폴더 사용).
  build: {
    outDir: 'dist-app',
    emptyOutDir: true,
    target: 'es2021',
    sourcemap: false,
  },
});
