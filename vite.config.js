import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  base: '/vid_craw/', // Nginx 설정과 일치
  plugins: [vue(), vueDevTools()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: {
      protocol: 'ws',
      host: '172.30.1.36', // 호스트 IP
      port: 80, // Nginx 프록시 포트
      path: '/vid_craw/ws', // WebSocket 경로 지정
      clientPort: 80, // 클라이언트 접속 포트
    },
    proxy: {
      '/api': {
        target: 'http://backend:5000',
        changeOrigin: true,
      },
    },
    watch: {
      usePolling: true,
    },
  },
})
