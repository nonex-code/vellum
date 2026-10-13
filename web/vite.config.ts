import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 构建产物输出到 web/dist，由 Go 的 go:embed 嵌入二进制。
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8420',
    },
  },
})