import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// dev 模式 API 代理到本机 webadmin 后端；构建产物由后端静态托管
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:9482',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
})
