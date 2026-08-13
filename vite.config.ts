import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    watch: {
      // Google Drive 등 네트워크 드라이브에서 파일 감시 오류 방지
      usePolling: true,
      interval: 1000,
      ignored: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.git/**',
        '**/.firebase/**',
        '**/firebase-debug*.log',
        '**/.thumbnail',
      ],
    },
  },
});
